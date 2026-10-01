'use strict';

const http = require('http');
const server = http.createServer(function onRequest(req, res) { res.end('hi'); });
server.listen(0, function onListen() {
  http.get(`http://127.0.0.1:${server.address().port}/`, function onResponse(res) {
    let body = '';
    res.on('data', function onChunk(c) { body += c; });
    res.on('end', function onEnd() { console.log(body); server.close(); });
  });
});
