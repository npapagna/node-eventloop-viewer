'use strict';
// Node runs fs and crypto work like pbkdf2 on libuv's thread pool, which
// has 4 threads by default. Five hashes fill all four threads, so the fifth hash
// and a small file read queued after them wait for a thread to free up,
// even though the event loop itself is idle: the timer runs right away.
// Set UV_THREADPOOL_SIZE to change the pool size.
const crypto = require('crypto');
const fs = require('fs');
const start = Date.now();

for (let i = 1; i <= 5; i++) {
  crypto.pbkdf2('secret', 'salt', 1_000_000, 32, 'sha256', function onHash() {
    console.log(`hash ${i} done after ${Date.now() - start} ms`);
  });
}
fs.readFile(__filename, function onRead() {
  console.log(`file read after ${Date.now() - start} ms`);
});
setTimeout(function onTimer() {
  console.log(`timer after ${Date.now() - start} ms`);
}, 0);
