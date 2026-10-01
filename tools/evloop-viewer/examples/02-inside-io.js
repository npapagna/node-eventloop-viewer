'use strict';
// Inside an I/O callback the order of setImmediate and setTimeout(0) is
// deterministic: the check phase comes before the next timers phase.
const fs = require('fs');
// Printing once up front keeps stdout's one-time setup cost out of the
// timing below, so the 0 ms timer isn't flagged as late.
console.log('reading this file');
fs.readFile(__filename, function onRead() {
  setTimeout(function timeout() { console.log('timeout'); }, 0);
  setImmediate(function immediate() { console.log('immediate'); });
  process.nextTick(function tick() { console.log('nextTick'); });
});
