// Flags: --no-warnings

'use strict';
const common = require('../common');
const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const tmpdir = require('../common/tmpdir');

common.skipIfPerfettoEnabled();
if (common.isWindows)
  common.skip('libuv phase events are only emitted on Unix');

// This tests that node.evloop trace events say what keeps the loop alive,
// when it exits, how Node adjusted and fired timers, and how promise
// rejections were handled.

if (process.argv[2] === 'child') {
  process.on('unhandledRejection', () => {});
  const late = Promise.reject(new Error('late'));
  const early = Promise.reject(new Error('early'));
  early.catch(() => {});
  setTimeout(function zero() { late.catch(() => {}); }, 0);
  setInterval(function idle() {}, 1000).unref();
  process.once('beforeExit', () => console.log('beforeExit'));
} else {
  tmpdir.refresh();

  // No IPC channel: it would keep the child's loop alive.
  const proc = cp.spawn(process.execPath, [
    '--trace-event-categories', 'node.evloop', __filename, 'child',
  ], { cwd: tmpdir.path, stdio: 'pipe' });

  proc.once('exit', common.mustCall(async (code) => {
    assert.strictEqual(code, 0);
    const file = tmpdir.resolve('node_trace.1.log');
    const events = JSON.parse(await fs.promises.readFile(file, 'utf8'))
      .traceEvents.filter((e) => e.cat !== '__metadata');
    const loopTid = events.find((e) => e.name === 'iteration').tid;
    const onLoop = events.filter((e) => e.tid === loopTid);
    const data = (e) => e.args?.data ?? {};

    // Keep-alive checks: the pending timer keeps the loop going, the unref'd
    // interval does not, and the loop exits once nothing is left.
    const checks = onLoop.filter((e) =>
      ['loop-start', 'alive', 'loop-exit'].includes(e.name));
    // test/common may hold a stderr pipe too, so only timers are checked.
    assert.strictEqual(checks[0].name, 'loop-start');
    assert.strictEqual(checks[0].args.alive, 1);
    assert.match(checks[0].args.resources, /(^|,)Timeout:1(,|$)/);
    assert(checks.some((e) => e.name === 'alive'));
    assert.strictEqual(checks.at(-1).name, 'loop-exit');
    assert.deepStrictEqual(checks.at(-1).args, { resources: '', alive: 0 });

    // 'beforeExit' listeners run inside a beforeExit span, after loop exit.
    const order = onLoop
      .filter((e) => e.name === 'beforeExit' || e.name === 'loop-exit' ||
                     data(e).queue === 'console')
      .map((e) => (e.name === 'beforeExit' ? `beforeExit:${e.ph}` :
        e.name === 'loop-exit' ? 'loop-exit' : data(e).text.trim()));
    assert.deepStrictEqual(order.slice(-4),
                           ['loop-exit', 'beforeExit:B', 'beforeExit', 'beforeExit:E']);

    // Timers report the delay asked for, and the loop time they fired at.
    const timerEvents = onLoop.map(data).filter((d) => d.queue === 'timers');
    const zero = timerEvents.find((d) => d.op === 'enqueue' && d.name === 'zero');
    assert.strictEqual(zero.requested, 0);
    assert.strictEqual(zero.delay, 1);
    const zeroRun = timerEvents.find((d) => d.op === 'run' && d.id === zero.id);
    assert.strictEqual(zeroRun.due, zero.due);
    assert(zeroRun.now >= zeroRun.due);
    const idle = timerEvents.find((d) => d.op === 'enqueue' && d.name === 'idle');
    assert(timerEvents.some((d) => d.op === 'unref' && d.id === idle.id));

    // A rejection handled synchronously never becomes unhandled; one handled
    // in a later timer is reported first and handled late.
    const rejections = new Map();
    for (const d of onLoop.map(data)) {
      if (d.queue !== 'rejection') continue;
      if (!rejections.has(d.id)) rejections.set(d.id, []);
      rejections.get(d.id).push(d.op === 'handled' ? `handled late=${d.late}` : d.op);
    }
    assert.deepStrictEqual([...rejections.values()], [
      ['reject', 'unhandled', 'handled late=true'],
      ['reject', 'handled late=false'],
    ]);
  }));
}
