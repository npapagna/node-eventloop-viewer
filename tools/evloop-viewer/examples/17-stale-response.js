'use strict';
// Search as you type: each keystroke sends a request, and each response
// replaces the results. Responses arrive in whatever order the server
// answers, so the slow request for "no" lands after the one for "node"
// and the user sees stale results. The fix is to drop any response whose
// query is no longer the latest one.
let results = '';

function fetchMatches(query, ms) {
  return new Promise((resolve) => setTimeout(resolve, ms, `matches for ${query}`));
}

async function search(query, ms) {
  const matches = await fetchMatches(query, ms);
  results = matches;
  console.log('showing', results);
}

search('no', 60); // Typed first, slow to answer
search('node', 20); // Typed last, answered first
