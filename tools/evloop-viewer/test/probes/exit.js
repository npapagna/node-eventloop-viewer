'use strict';

process.on('exit', function onExit(code) { console.log('exit', code); });
setTimeout(function later() { console.log('never'); }, 50);
setTimeout(function quit() { process.exit(0); }, 5);
