'use strict';

const { execFile } = require('child_process');
execFile(process.execPath, ['-e', 'console.log(1)'], function onExit(err, out) {
  console.log('child said', out.trim());
});
