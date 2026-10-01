'use strict';

let n = 0;
process.on('beforeExit', function again() { if (n++ < 1) setTimeout(function more() { console.log('more'); }, 1); });
