'use strict';

const fs = require('fs');
fs.readFile(__filename, function onRead(err, data) { console.log('read', data.length); });
fs.stat(__filename, function onStat() { console.log('stat'); });
