'use strict';

setTimeout(function late() { console.log('late'); }, 1);
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60);
console.log('unblocked');
