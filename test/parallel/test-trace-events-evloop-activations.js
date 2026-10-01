// Flags: --no-warnings

'use strict';
const common = require('../common');
const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const tmpdir = require('../common/tmpdir');

common.skipIfPerfettoEnabled();

// This tests that, with node.evloop tracing, each call of an async function
// reports when it starts, pauses at an await, resumes and ends, without
// changing what the code does.

if (process.argv[2] === 'child') {
  async function step(tag) {
    'use strict'; // eslint-disable-line strict
    await null;
    const v = await new Promise((r) => setTimeout(() => r(tag), 1)) // eslint-disable-line @stylistic/js/semi
    return v;
  }
  const wrap = async (x) => ({ x: await step(x) });
  const multiline = async () =>
    await step('m');
  async function recovers() {
    try { await Promise.reject(new Error('no')); } catch { return 'caught'; }
  }
  const obj = { async self() { return this === obj; } };
  async function strict() { 'use strict'; return this; } // eslint-disable-line strict
  Promise.all([step('a'), wrap('b'), multiline(), recovers(), obj.self(), strict()])
    .then(common.mustCall((r) => { console.log(JSON.stringify(r)); }));
} else {
  tmpdir.refresh();

  const proc = cp.spawnSync(process.execPath, [
    '--trace-event-categories', 'node.evloop', __filename, 'child',
  ], { cwd: tmpdir.path, encoding: 'utf8' });

  assert.strictEqual(proc.stderr, '');
  assert.deepStrictEqual(JSON.parse(proc.stdout),
                         ['a', { x: 'b' }, 'm', 'caught', true, null]);

  const events = JSON.parse(fs.readFileSync(tmpdir.resolve('node_trace.1.log'), 'utf8'))
    .traceEvents.map((e) => e.args?.data).filter(Boolean);
  const source = events.find((d) => d.queue === 'src' && d.op === 'source' &&
                             d.file === __filename);
  const fns = new Map(source.asyncFns.map(([id, , , name]) => [id, name]));
  assert.deepStrictEqual([...fns.values()],
                         ['step', 'wrap', 'multiline', 'recovers', 'self', 'strict']);

  // One line per event: "<function>#<call> <op> [<await text>]".
  const calls = new Map();
  const awaitText = (at) => source.text.slice(at).split(/;|\n| \/\//)[0];
  const log = events.filter((d) => d.queue === 'act').map((d) => {
    if (d.op === 'enter') calls.set(d.id, `${fns.get(d.fn)}#${d.id}`);
    return `${calls.get(d.id)} ${d.op}${d.at === undefined ? '' : ` ${awaitText(d.at)}`}`;
  });

  // Each call has its own id, so two calls of `step` that pause at the same
  // await can be told apart.
  const of = (call) => log.filter((l) => l.startsWith(`${call} `));
  assert.deepStrictEqual(of('step#1'), [
    'step#1 enter',
    'step#1 await await null',
    'step#1 resume await null',
    'step#1 await await new Promise((r) => setTimeout(() => r(tag), 1))',
    'step#1 resume await new Promise((r) => setTimeout(() => r(tag), 1))',
    'step#1 exit',
  ]);
  assert.strictEqual(of('step#3').length, 6);
  // While step#1 is paused at its first await, the next call starts.
  assert(log.indexOf('step#1 await await null') < log.indexOf('wrap#2 enter'));
  assert(log.indexOf('wrap#2 enter') < log.indexOf('step#1 resume await null'));

  // A rejected await resumes by throwing, which reports no resume.
  const rejected = log.filter((l) => l.startsWith('recovers#'));
  assert.deepStrictEqual(rejected.map((l) => l.replace(/#\d+/, '')), [
    'recovers enter',
    'recovers await await Promise.reject(new Error(\'no\'))',
    'recovers exit',
  ]);
}
