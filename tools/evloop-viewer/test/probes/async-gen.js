'use strict';

async function* gen() { yield 1; await null; yield 2; }

async function main() {
  for await (const v of gen()) console.log(v);
}
main();
