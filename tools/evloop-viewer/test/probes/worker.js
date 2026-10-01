'use strict';

const { Worker } = require('worker_threads');
const w = new Worker('setTimeout(() => require("worker_threads").parentPort.postMessage("hi"), 5)', { eval: true });
w.on('message', function onMessage(m) { console.log('worker said', m); });
w.on('exit', function onExit() { console.log('worker exit'); });
