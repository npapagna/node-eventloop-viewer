'use strict';

const m = require('./lib-esm.mjs');
console.log(m.value);
import('./lib-esm.mjs').then(function loaded(ns) { console.log('dyn', ns.value); });
