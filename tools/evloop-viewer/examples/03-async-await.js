'use strict';
// How await splits a function into microtasks.
async function inner() {
  console.log('inner start');
  await null;
  console.log('inner after await');
}

async function outer() {
  console.log('outer start');
  await inner();
  console.log('outer after await');
}
outer();
Promise.resolve().then(function other() { console.log('other promise'); });
console.log('sync end');
