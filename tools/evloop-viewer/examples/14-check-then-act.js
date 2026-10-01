'use strict';
// Two withdrawals check the balance, then await, then subtract. The await
// waits on nothing (no I/O, no timer), yet the second call still runs its
// check before the first one subtracts, so both pass and the balance goes
// negative. Code between two awaits is atomic; a value read before an
// await may be stale after it.
let balance = 100;

async function withdraw(name, amount) {
  console.log(name, 'checks', balance);
  if (balance >= amount) {
    await null;
    balance -= amount;
    console.log(name, 'withdrew, balance', balance);
  }
}

withdraw('A', 80);
withdraw('B', 80);
