'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const als = new AsyncLocalStorage();
als.run(1, function inRun() { setTimeout(function t() { console.log('store', als.getStore()); }, 1); });
