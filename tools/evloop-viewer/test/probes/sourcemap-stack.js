'use strict';

function f() { return new Error('where').stack.split('\n')[1]; }
console.log(f());
