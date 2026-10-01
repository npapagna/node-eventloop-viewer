'use strict';

const vm = require('vm');
vm.runInNewContext('setTimeout(function inVm() { console.log("vm"); }, 1)', { setTimeout, console });
eval('setTimeout(function inEval() { console.log("eval"); }, 1)');
new Function('setTimeout(function inFn() { console.log("fn"); }, 1)')();
