'use strict';

class A { #x = 1; static s = 2; get x() { return this.#x; } static { console.log('static block'); } }
console.log(new A().x, A.s);
const o = { a: { b: 1 } };
console.log(o?.a?.b ?? 0);
function* g() { const v = yield 1; console.log('got', v); }
const it = g(); it.next(); it.next(5);
label: for (const i of [1, 2]) { for (const j of [1, 2]) { if (j === 2) continue label; console.log(i, j); } }
