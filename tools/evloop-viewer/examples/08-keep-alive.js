'use strict';
// The loop keeps going while something refs it. The server keeps the
// process alive until it closes; an unref'd timer never does.
const net = require('node:net');
const server = net.createServer().listen(0, function listening() {
  console.log('listening');
  setTimeout(function stop() {
    server.close(function closed() { console.log('server closed'); });
  }, 20);
});
setInterval(function never() {}, 1000).unref();
process.once('beforeExit', function beforeExit() {
  console.log('beforeExit: nothing left, one last chance');
});
