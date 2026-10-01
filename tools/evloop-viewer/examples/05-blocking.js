'use strict';
// A timer that does 50 ms of synchronous work makes every other callback
// wait, so the second timer runs late even though it was due long before.
setTimeout(function busy() {
  // Sleeps synchronously, like a heavy computation or a *Sync call would.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  console.log('busy timer done');
}, 0);
setTimeout(function punctual() {
  console.log('second timer (due at 5 ms)');
}, 5);
