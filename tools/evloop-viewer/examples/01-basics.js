'use strict';
// Sync code, then nextTick, then promises, then timers vs immediates.
console.log('sync start');
setTimeout(function timeout() { console.log('timeout'); }, 0);
setImmediate(function immediate() { console.log('immediate'); });
Promise.resolve().then(function promiseThen() { console.log('promise'); });
queueMicrotask(function micro() { console.log('queueMicrotask'); });
process.nextTick(function tick() { console.log('nextTick'); });
console.log('sync end');
