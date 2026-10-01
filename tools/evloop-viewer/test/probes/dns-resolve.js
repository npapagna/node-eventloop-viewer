'use strict';

const dns = require('dns');
dns.resolve4('localhost', function onResolve(err) { console.log('resolve', err ? err.code : 'ok'); });
