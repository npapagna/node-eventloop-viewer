// Flags: --no-warnings

'use strict';
const common = require('../common');
const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const tmpdir = require('../common/tmpdir');

common.skipIfPerfettoEnabled();

// This tests that, with node.evloop tracing, user code reports each statement
// and expression in evaluation order without changing what the code does.

if (process.argv[2] === 'child') {
  function f(v) { return v + 1; }

  function a() { return 1; }

  function b() { return 2; }
  const total = f(a()) + b();

  const obj = { n: 5, get() { return this.n; } };
  const [p, q] = [1, 2];
  let s1, s2;
  ({ s1, s2 = p + q } = { s1: 3 }); // eslint-disable-line prefer-const
  outer: for (const x of [x0()]) { for (;;) { continue outer; } } // eslint-disable-line no-unused-vars
  function x0() { return 0; }
  console.log(JSON.stringify([
    total, obj.get(), typeof notDeclared, obj?.missing?.x, s1, s2, // eslint-disable-line no-undef
  ]));

  setTimeout(function later() { console.log('in callback'); }, 0);
  setTimeout(() => { throw new Error('line check'); }, 1);
} else {
  tmpdir.refresh();

  const proc = cp.spawnSync(process.execPath, [
    '--trace-event-categories', 'node.evloop', __filename, 'child',
  ], { cwd: tmpdir.path, encoding: 'utf8' });

  const lines = proc.stdout.trim().split('\n');
  assert.deepStrictEqual(JSON.parse(lines[0]), [4, 5, 'undefined', null, 3, 3]);
  assert.strictEqual(lines[1], 'in callback');

  // The error thrown on line 34 of this file still reports that line.
  assert.match(proc.stderr, new RegExp(`${RegExp.escape(__filename)}:34\\b`));

  const events = JSON.parse(fs.readFileSync(tmpdir.resolve('node_trace.1.log'), 'utf8'))
    .traceEvents.map((e) => e.args?.data).filter(Boolean);

  const source = events.find((d) => d.queue === 'src' && d.op === 'source' &&
                             d.file === __filename);
  assert.strictEqual(source.text, fs.readFileSync(__filename, 'utf8'));

  const text = (id) => {
    const [, start, end] = source.nodes[id - source.base];
    return source.text.slice(start, end);
  };
  // test/common is instrumented too; keep only this file's probes.
  const inThisFile = (d) => d.queue === 'src' && d.op !== 'source' &&
    d.id >= source.base && d.id < source.base + source.nodes.length;
  const steps = events.filter(inThisFile).map((d) => `${d.op} ${text(d.id)}`);

  const from = steps.indexOf('s const total = f(a()) + b();');
  assert.deepStrictEqual(steps.slice(from, from + 14), [
    's const total = f(a()) + b();',
    'e f(a()) + b()',
    'e f(a())',
    'e a()',
    's return 1;',
    'x a()',
    's return v + 1;',
    'e v + 1',
    'x v + 1',
    'x f(a())',
    'e b()',
    's return 2;',
    'x b()',
    'x f(a()) + b()',
  ]);

  // Statements inside a callback appear after the callback starts running.
  const ordered = events.filter((d) =>
    (d.queue === 'timers' && d.op === 'run') ||
    (inThisFile(d) && d.op === 's' && text(d.id) === "console.log('in callback');"));
  assert.strictEqual(ordered[0].queue, 'timers');
  assert.strictEqual(ordered[1].queue, 'src');

  // A queued callback's position in the instrumented code leads back to that
  // callback's own original source, even when the code is anonymous.
  const callbackCode = (d) => {
    const [start, end] = source.funcs
      .filter((f) => f[2] <= d.fn[1] && d.fn[1] < f[3])
      .sort((x, y) => (x[3] - x[2]) - (y[3] - y[2]))[0];
    return source.text.slice(start, end);
  };
  const timers = events.filter((d) => d.queue === 'timers' && d.op === 'enqueue' &&
                               d.fn?.[0] === __filename);
  assert.deepStrictEqual(timers.map(callbackCode), [
    "function later() { console.log('in callback'); }",
    "() => { throw new Error('line check'); }",
  ]);
}
