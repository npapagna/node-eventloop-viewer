'use strict';

const crypto = require('crypto');
crypto.pbkdf2('pw', 'salt', 1000, 32, 'sha256', function onKey() { console.log('key'); });
crypto.randomBytes(8, function onBytes() { console.log('bytes'); });
