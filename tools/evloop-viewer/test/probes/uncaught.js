'use strict';

process.on('uncaughtException', function onErr(e) { console.log('caught', e.message); });
setTimeout(function boom() { throw new Error('boom'); }, 1);
setTimeout(function after() { console.log('after'); }, 5);
