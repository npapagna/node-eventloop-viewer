console.log('a');
await new Promise((r) => setTimeout(r, 5));
console.log('b');
