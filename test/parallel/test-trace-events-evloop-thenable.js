// Flags: --no-warnings

'use strict';
const common = require('../common');
const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const tmpdir = require('../common/tmpdir');

common.skipIfPerfettoEnabled();

// This tests that node.evloop trace events show both jobs V8 runs to resolve
// a promise with another promise, attributed to the line that created the
// promise being resolved.

if (process.argv[2] === 'child') {
  new Promise((resolve) => resolve(Promise.resolve()));
  async function returnsPromise() { return Promise.resolve(); }
  returnsPromise();
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
      .filter((d) => d?.queue === 'microtask' && d.site?.includes(__filename));
    const line = (d) => +/:(\d+):\d+$/.exec(d.site)[1];

    const jobs = events
      .filter((d) => d.kind === 'thenable job' || d.kind === 'adopt job')
      .map((d) => [d.op, d.kind, line(d)]);
    assert.deepStrictEqual(jobs, [
      ['run', 'thenable job', 17],
      ['enqueue', 'adopt job', 17],
      ['run', 'thenable job', 18],
      ['enqueue', 'adopt job', 18],
    ]);
  }));
}
