'use strict';
// A nextTick that keeps queueing nextTicks never lets the loop move on:
// the timer was due after 1 ms but waits until the chain stops.
setTimeout(function timer() { console.log('timer finally ran'); }, 0);
let n = 0;
function again() {
  if (++n < 500) process.nextTick(again);
  else console.log(`${n} nextTicks done`);
}
process.nextTick(again);
