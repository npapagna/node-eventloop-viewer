'use strict';
// Node keeps one list of timers per delay. In the timers phase it runs
// every expired timer of one list before the next list, so timers with
// different delays can run out of due order. Also: 0 ms means 1 ms.
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
setTimeout(function a() { console.log('a: 10 ms list, due at 10'); }, 10);
sleep(5);
setTimeout(function b() { console.log('b: 10 ms list, due at 15'); }, 10);
setTimeout(function c() { console.log('c: 6 ms list, due at 11'); }, 6);
setTimeout(function zero() { console.log('zero: asked for 0 ms'); }, 0);
sleep(20); // Everything is overdue when the loop starts
