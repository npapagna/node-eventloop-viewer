'use strict';

const http = require('http');
const server = http.createServer(function onRequest(req, res) { res.end('hi'); });
server.listen(0, async function onListen() {
  const r = await fetch(`http://127.0.0.1:${server.address().port}/`);
  console.log(await r.text());
  server.close();
});
