'use strict';

const dns = require('dns');
dns.lookup('localhost', function onLookup(err) { console.log('lookup', !err); });
