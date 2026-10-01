'use strict';

const zlib = require('zlib');
zlib.gzip('hello', function onGzip(err, buf) { console.log('gz', buf.length); });
