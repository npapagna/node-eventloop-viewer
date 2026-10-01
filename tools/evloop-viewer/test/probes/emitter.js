'use strict';

const { EventEmitter } = require('events');
const e = new EventEmitter();
e.on('ping', function onPing() {
  Promise.resolve().then(function inListener() { console.log('micro in listener'); });
  console.log('ping');
});
setTimeout(function fire() { e.emit('ping'); console.log('after emit'); }, 1);
const t = new EventTarget();
t.addEventListener('x', function onX() { console.log('x'); });
t.dispatchEvent(new Event('x'));
