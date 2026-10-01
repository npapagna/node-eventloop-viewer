{
  using resource = { [Symbol.dispose]() { console.log('disposed'); } };
  console.log('in block', typeof resource);
}
setTimeout(() => console.log('after'), 1);
