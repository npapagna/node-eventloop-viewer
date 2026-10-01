'use strict';
// `.then` on a promise that has already settled queues its callback right
// away. On a pending promise the callback waits, and it is queued only when
// that promise settles: here, when the timer calls resolveLater().
const ready = Promise.resolve('ready');
ready.then((v) => console.log(`A: ${v}`));

let resolveLater;
const later = new Promise((resolve) => { resolveLater = resolve; });
later.then((v) => console.log(`B: ${v}`));

setTimeout(() => resolveLater('resolved by a timer'), 10);
