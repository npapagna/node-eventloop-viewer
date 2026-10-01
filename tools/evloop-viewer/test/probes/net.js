'use strict';

const net = require('net');
const server = net.createServer(function onConn(sock) {
  sock.on('data', function onServerData() { sock.end('pong'); });
});
server.listen(0, function onListen() {
  const c = net.connect(server.address().port, function onConnect() { c.write('ping'); });
  c.on('data', function onData(d) { console.log('got', String(d)); });
  c.on('close', function onClose() { console.log('closed'); server.close(); });
});
