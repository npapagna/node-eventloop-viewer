'use strict';

const { setTimeout: sleep, setImmediate: immediate } = require('timers/promises');
async function main() {
  await sleep(5);
  console.log('slept');
  await immediate();
  console.log('immediate');
}
main();
