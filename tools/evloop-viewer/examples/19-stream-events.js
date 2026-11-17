'use strict';
// Stream events beat a promise job queued before them. Adding a 'data'
// listener makes Node queue its own resume_ nextTick, which reads the
// stream and emits 'data'; that queues endReadableNT, another nextTick,
// which emits 'end'. Node empties the nextTick queue before any promise job.
const { Readable } = require('node:stream');
const stream = new Readable({ read() {} });
stream.push('a');
stream.push(null);
stream.on('data', function onData(chunk) { console.log('data', String(chunk)); });
stream.on('end', function onEnd() { console.log('end'); });
Promise.resolve().then(function afterPromise() { console.log('promise job'); });
console.log('listeners attached');
