'use strict';
// Three ways to produce the value 'x' from a promise callback. Returning a
// promise adds extra microtask turns, so 'returned a promise' prints last.
Promise.resolve()
  .then(() => Promise.resolve('x'))
  .then(() => console.log('returned a promise'));
Promise.resolve()
  .then(() => 'x')
  .then(() => console.log('returned a value'));
(async () => {
  await 'x';
  console.log('after await');
})();
