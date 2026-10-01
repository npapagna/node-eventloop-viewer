'use strict';

const net = require('net');
const s = net.connect(1, '127.0.0.1');
s.on('error', function onError(e) { console.log('err', e.code); });
s.on('close', function onClose() { console.log('close'); });
