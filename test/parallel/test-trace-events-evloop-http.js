// Flags: --no-warnings

'use strict';
const common = require('../common');
const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const http = require('http');
const tmpdir = require('../common/tmpdir');

common.skipIfPerfettoEnabled();
if (common.isWindows)
  common.skip('libuv phase events are only emitted on Unix');

// This tests that node.evloop reports an HTTP server's request handler as an
// I/O callback. The server's parser reads the socket itself and calls into
// JavaScript without MakeCallback, so without its own "io" event the handler
// would look like code running outside any callback.

if (process.argv[2] === 'child') {
  const server = http.createServer(common.mustCall((req, res) => {
    console.log('request');
    res.end('hi');
  }));
  server.listen(0, common.mustCall(() => {
    http.get(`http://127.0.0.1:${server.address().port}/`, common.mustCall((res) => {
      console.log('response');
      res.resume();
      res.on('end', common.mustCall(() => server.close()));
    }));
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

    const open = [];
    const printedIn = {};
    for (const e of events.filter((e) => e.tid === loopTid)) {
      if (e.name === 'io') {
        if (e.ph === 'B') open.push(e.args.provider); else open.pop();
      } else if (e.args?.data?.queue === 'console') {
        printedIn[e.args.data.text.trim()] = [...open];
      }
    }

    assert.deepStrictEqual(printedIn.request, ['HTTPINCOMINGMESSAGE']);
    assert.deepStrictEqual(printedIn.response, ['TCPWRAP']);
  }));
}
