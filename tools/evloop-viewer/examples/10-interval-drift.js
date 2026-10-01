'use strict';
// setInterval re-arms from when each run started, not from the original
// schedule, so a slow callback pushes every later run back.
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const t0 = Date.now();
let n = 0;
const id = setInterval(function tick() {
  console.log(`run ${++n} at ${Date.now() - t0} ms`);
  sleep(15); // Longer than the 10 ms interval
  if (n === 4) clearInterval(id);
}, 10);
