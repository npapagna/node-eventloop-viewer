'use strict';

// Usage: node show.js <trace> [regex] : prints each step's explanation.
const { render } = require('./viewer-env.js');
const [name, re, gran] = process.argv.slice(2);
const r = render(name, gran || 'events');
console.log('GOTCHAS:', r.gotchas.join(' | '));
for (const s of r.out) {
  if (re && !new RegExp(re).test(s.explain)) continue;
  console.log(`[${s.i + 1}] ${s.explain}\n     UP NEXT: ${s.upnext} | ${s.actual}`);
}
