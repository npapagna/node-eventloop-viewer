'use strict';

async function main() {
  try { await Promise.reject(new Error('x')); } catch (e) { console.log('caught', e.message); }
  await null;
  console.log('end');
}
main();
