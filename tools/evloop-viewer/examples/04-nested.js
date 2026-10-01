'use strict';
// nextTicks and microtasks queued from inside timers run before the next
// timer callback, not after all timers.
setTimeout(function first() {
  console.log('timeout 1');
  process.nextTick(function tick() { console.log('tick from timeout 1'); });
  Promise.resolve().then(function p() { console.log('promise from timeout 1'); });
}, 0);
setTimeout(function second() { console.log('timeout 2'); }, 0);
setImmediate(function imm() {
  console.log('immediate');
  setImmediate(function imm2() { console.log('immediate scheduled by immediate'); });
});
