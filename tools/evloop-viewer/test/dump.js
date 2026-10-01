'use strict';

// Usage: node dump.js <trace-file> <regex> : prints matching node.evloop events.
const [f, re] = process.argv.slice(2);
const j = JSON.parse(require('fs').readFileSync(f, 'utf8'));
for (const e of j.traceEvents) {
  if (!e.cat.split(',').includes('node.evloop')) continue;
  const d = e.args?.data; const s = typeof d === 'string' ? d : JSON.stringify(d ?? e.args);
  if (new RegExp(re).test(e.name + ' ' + s)) console.log(e.ph, e.name, s.slice(0, 170));
}
