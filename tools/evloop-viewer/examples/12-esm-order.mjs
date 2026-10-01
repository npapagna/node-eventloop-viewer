// The same three lines print in a different order than in a CommonJS file:
// an ES module's top-level code runs inside the microtask queue, so promise
// jobs queued here run before the nextTick.
import { nextTick } from 'node:process';

Promise.resolve().then(() => console.log('promise'));
queueMicrotask(() => console.log('queueMicrotask'));
nextTick(() => console.log('nextTick'));
