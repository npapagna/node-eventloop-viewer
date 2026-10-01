'use strict';
// An async function that looks atomic, called twice at once. The fake
// database keeps one result at a time, so the calls overwrite each other.
let result = null;
let complete = false;

function execute(sql) {
  result = null;
  complete = false;
  setTimeout(() => {
    result = `rows for ${sql}`;
    complete = true;
  }, 250);
  return Promise.resolve();
}
const isQueryComplete = () => complete;
const getQueryResults = async () => result;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function executeAsync(sqlQuery) {
  await execute(sqlQuery);
  while (!isQueryComplete()) { await sleep(100); }
  return await getQueryResults();
}

executeAsync('SELECT a').then((rows) => console.log('A got', rows));
executeAsync('SELECT b').then((rows) => console.log('B got', rows));
