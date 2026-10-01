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

// This tests that node.evloop trace events describe which loop phase each
// callback ran in, and when user callbacks entered and left each queue.

const phases = new Set([
  'timers', 'pending', 'idle', 'prepare', 'poll', 'check', 'close',
]);

if (process.argv[2] === 'child') {
  fs.readFile(__filename, common.mustCall(function onRead() {
    setTimeout(function onTimeout() { console.log('timeout'); }, 0);
    setImmediate(function onImmediate() { console.log('immediate'); });
    Promise.resolve().then(common.mustCall(function onPromise() { console.log('promise'); }));
    process.nextTick(function onTick() { console.log('nextTick'); });
  }));
} else {
  tmpdir.refresh();

  const proc = cp.fork(__filename, ['child'], {
    cwd: tmpdir.path,
    execArgv: ['--trace-event-categories', 'node.evloop'],
    stdio: 'pipe',
  });

  proc.once('exit', common.mustCall(async (code) => {
    assert.strictEqual(code, 0);
    const file = tmpdir.resolve('node_trace.1.log');
    const events = JSON.parse(await fs.promises.readFile(file, 'utf8'))
      .traceEvents.filter((e) => e.cat !== '__metadata');
    const loopTid = events.find((e) => e.name === 'iteration').tid;
    const onLoop = events.filter((e) => e.tid === loopTid);

    let phase = 'main script';
    const output = [];
    const enqueued = new Map();
    const ranWithoutEnqueue = [];
    for (const e of onLoop) {
      if (phases.has(e.name)) {
        phase = e.ph === 'B' ? e.name : 'between phases';
        continue;
      }
      const data = e.args?.data;
      if (data?.queue === 'console') {
        output.push([data.text.trim(), phase]);
      } else if (data?.op === 'enqueue') {
        enqueued.set(`${data.queue}:${data.id}`, data);
      } else if (data?.op === 'run' &&
                 !enqueued.has(`${data.queue}:${data.id}`)) {
        ranWithoutEnqueue.push(data);
      }
    }

    assert.deepStrictEqual(output, [
      ['nextTick', 'poll'],
      ['promise', 'poll'],
      ['immediate', 'check'],
      ['timeout', 'timers'],
    ]);

    const userEnqueues = [...enqueued.values()]
      .filter((e) => e.site?.includes(__filename))
      .map((e) => `${e.queue}:${e.name}`);
    assert.deepStrictEqual(userEnqueues, [
      'timers:onTimeout',
      'immediate:onImmediate',
      'microtask:promise reaction',
      'nextTick:onTick',
    ]);

    assert.deepStrictEqual(ranWithoutEnqueue, []);
  }));
}
