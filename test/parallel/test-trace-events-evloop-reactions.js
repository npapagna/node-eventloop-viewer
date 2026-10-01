// Flags: --no-warnings

'use strict';
const common = require('../common');
const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const tmpdir = require('../common/tmpdir');

common.skipIfPerfettoEnabled();

// This tests that node.evloop trace events record each .then call, and what
// queued its reaction: the call itself on a settled promise, or the promise
// settling later.

if (process.argv[2] === 'child') {
  Promise.reject(new Error('settled')).catch(() => {});
  let resolveLater;
  new Promise((resolve) => { resolveLater = resolve; }).then(common.mustCall());
  setImmediate(() => resolveLater());
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
      .traceEvents.map((e) => e.args?.data)
      .filter((d) => d?.queue === 'microtask' && d.site?.includes(__filename) &&
              (d.op === 'then' || d.op === 'enqueue'));
    const line = (site) => +/:(\d+):\d+$/.exec(site)[1];

    assert.deepStrictEqual(events.map((d) => ({
      op: d.op,
      line: line(d.site),
      settled: d.settled,
      cause: d.cause,
      outcome: d.outcome,
      byLine: d.bySite && line(d.bySite),
    })), [
      { op: 'then', line: 17, settled: true, cause: undefined, outcome: undefined, byLine: undefined },
      { op: 'enqueue', line: 17, settled: undefined, cause: 'then', outcome: 'rejected', byLine: undefined },
      { op: 'then', line: 19, settled: false, cause: undefined, outcome: undefined, byLine: undefined },
      { op: 'enqueue', line: 19, settled: undefined, cause: 'settle', outcome: 'fulfilled', byLine: 20 },
    ]);
  }));
}
