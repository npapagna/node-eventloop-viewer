'use strict';

const ac = new AbortController();
ac.signal.addEventListener('abort', function onAbort() { console.log('aborted'); });
setTimeout(function fire() { ac.abort(); }, 5);
const s = AbortSignal.timeout(10);
s.onabort = function onabort() { console.log('timeout signal'); };
setTimeout(function keep() {}, 20);
