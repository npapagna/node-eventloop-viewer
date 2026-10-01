'use strict';
// Both promises are resolved right away, but resolving with a promise adopts
// its state through two extra microtask turns, so 'resolved with a promise'
// prints after 'tick 2'. V8 reports no event when the first of those jobs is
// queued, so it first shows up when it runs.
const p = Promise.resolve('value');

new Promise((resolve) => resolve('value'))
  .then(() => console.log('resolved with a value'));

new Promise((resolve) => resolve(p))
  .then(() => console.log('resolved with a promise'));

Promise.resolve()
  .then(() => console.log('tick 1'))
  .then(() => console.log('tick 2'))
  .then(() => console.log('tick 3'));
