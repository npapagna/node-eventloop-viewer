'use strict';
// A rejection only counts as unhandled once the microtask queue has
// drained. A handler attached in a microtask is in time; one attached
// in a timer is too late.
process.on('unhandledRejection', function report(err) {
  console.log(`unhandledRejection: ${err.message}`);
});
const early = Promise.reject(new Error('early'));
queueMicrotask(function attachEarly() {
  early.catch(function caughtEarly() { console.log('early: caught in time'); });
});
const late = Promise.reject(new Error('late'));
setTimeout(function attachLate() {
  late.catch(function caughtLate() { console.log('late: caught, but too late'); });
}, 0);
