'use strict';

const fsp = require('fs/promises');
async function main() {
  const data = await fsp.readFile(__filename);
  console.log('read', data.length);
  const st = await fsp.stat(__filename);
  console.log('stat', st.isFile());
}
main();
