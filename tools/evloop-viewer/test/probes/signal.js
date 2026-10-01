'use strict';

// Node unrefs signal handles, so a listener alone doesn't keep the loop
// alive: if `send` ran in the timers phase that ends an iteration, the loop
// would exit before poll reads the signal. The 1 s timer keeps it alive until
// the signal arrives.
const keepAlive = setTimeout(function giveUp() { console.log('no signal'); }, 1000);
process.on('SIGUSR2', function onSig() {
  console.log('signal');
  process.removeAllListeners('SIGUSR2');
  clearTimeout(keepAlive);
});
setTimeout(function send() { process.kill(process.pid, 'SIGUSR2'); }, 1);
