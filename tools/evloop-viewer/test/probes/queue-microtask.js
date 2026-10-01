'use strict';

queueMicrotask(function first() { console.log('qm'); });
process.nextTick(function tick() { console.log('tick'); });
