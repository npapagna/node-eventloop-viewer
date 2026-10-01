'use strict';

const { Readable, Writable, pipeline } = require('stream');
const out = [];
const sink = new Writable({ write(chunk, enc, cb) { out.push(String(chunk)); cb(); } });
pipeline(Readable.from(['a', 'b', 'c']), sink, function onDone() {
  console.log('done', out.join(''));
});
