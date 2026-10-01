'use strict';

// Usage: node retrace.js. Re-runs every example through the running viewer
// server (server.js) and overwrites its saved trace in traces/.
const fs = require('fs');
const path = require('path');
const traces = path.join(__dirname, '..', 'traces');
const B = 'http://127.0.0.1:8765';
(async () => {
  const page = await (await fetch(B + '/')).text();
  const token = /evloop-token" content="([0-9a-f]+)/.exec(page)[1];
  const examples = await (await fetch(B + '/api/examples')).json();
  for (const { name, code } of examples) {
    const res = await fetch(B + '/api/run', {
      method: 'POST',
      headers: { 'origin': B, 'content-type': 'application/json', 'x-evloop-token': token },
      body: JSON.stringify({ name, code }),
    });
    const r = await res.json();
    fs.writeFileSync(path.join(traces, `${name.replace(/\.m?js$/, '')}.json`), r.trace);
    console.log(name, 'exit', r.exitCode, JSON.stringify(r.stdout));
  }
})();
