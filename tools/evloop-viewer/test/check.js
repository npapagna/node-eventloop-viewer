'use strict';

// Renders every step of each trace with the viewer code and asserts the
// explanations the viewer is supposed to give.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { render, els, mk, m, text, viewerDir } = require('./viewer-env.js');
const has = (r, pred, re, what) => assert(r.out.some((s) => pred(s.e) && re.test(s.explain)), what);
const run = (q) => (e) => e.kind === 'queue' && e.op === 'run' && e.queue === q;

// Every trace renders at every granularity without throwing.
for (const f of fs.readdirSync(path.join(viewerDir, 'traces'))) {
  for (const g of ['events', 'stmt', 'expr']) render(f.replace(/\.json$/, ''), g);
}

let r = render('02-inside-io');
has(r, (e) => e.kind === 'phase' && e.phase === 'poll' && e.begin && e.timeout !== 0, /nearest timer|timer inside Node|until I\/O|without blocking/, '02 poll explained');
has(r, run('immediate'), /I\/O callback.*check phase/, '02 immediate inside I/O rule');
for (const s of r.out.filter((s) => s.e.kind === 'queue' && s.e.op === 'run'))
  assert(/Why now\?/.test(s.explain) && /Queued at step \d+/.test(s.explain), `02 run step has why + cause: ${s.explain}`);
assert(!r.gotchas.some((g) => /blocked|Race|await|promise/.test(g)), `02 gotchas: ${r.gotchas}`);
// I/O callbacks are named after the user function they run, and an empty
// set of queues does not count as a wrong prediction of them.
has(r, (e) => e.kind === 'io' && e.begin, /Running the I\/O callback onRead/, '02 I/O callback named');
assert(r.out.some((s) => /Next to run: I\/O callback onRead \. I\/O callbacks wait in no queue/.test(s.actual)), '02 I/O not predictable');
assert(!r.out.some((s) => /✗ differs/.test(s.actual)), '02 nothing flagged as mispredicted');
// A timer queued in I/O explains why it runs after the immediate.
has(r, run('timers'), /Queued inside an I\/O callback.*setImmediate queued from the same callback always runs before it/, '02 timer after immediate');
assert(!r.out.some((s) => /Why now\? Why now\?/.test(s.explain)), '"Why now?" said once');

r = render('04-nested');
assert(r.gotchas.some((g) => /Race/.test(g)), '04 race gotcha');
has(r, run('microtask'), /after each timer or immediate/, '04 microtasks between timers');
// The recording must show the point of the example: both timers in one
// timers phase, with the nextTick and microtask drained between them.
{
  const runs = r.out.filter((s) => run('timers')(s.e)).map((s) => s.i);
  const between = r.out.slice(runs[0], runs[1]);
  assert(!between.some((s) => s.e.kind === 'phase' && s.e.begin),
         '04 both timers in one timers phase (re-record if not)');
  assert(between.some((s) => run('nextTick')(s.e)) && between.some((s) => run('microtask')(s.e)),
         '04 drain between timers');
}
// A promise reaction is named after the one handler on its .then line.
has(r, (e) => e.kind === 'queue' && e.op === 'enqueue' && e.queue === 'microtask', /, so p is added to the microtask queue right away/, '04 reaction named by handler');

r = render('03-async-await');
has(r, (e) => e.kind === 'queue' && e.op === 'enqueue' && e.queue === 'microtask', /await null.*pauses the code it is in/, '03 await explained');

r = render('05-blocking');
assert(r.gotchas.some((g) => /busy blocked the event loop/.test(g)), `05 blocking gotcha: ${r.gotchas}`);
has(r, run('timers'), /ran [\d.]+ ms late, waiting for busy.*due at \d+ ms on Node's loop clock.*already \d+ ms late/, '05 exact lateness blamed on busy');

r = render('06-promise-hops');
assert(r.gotchas.some((g) => /Returning a promise/.test(g)), '06 thenable gotcha');

// Resolving with a promise runs a thenable job that V8 queues with no event.
// It queues an adopt job, and only that one queues the reaction, so the
// reaction runs after tick 2.
r = render('15-resolve-with-promise');
assert(r.gotchas.includes('Resolving with a promise adds microtask hops'), `15 gotcha: ${r.gotchas}`);
has(r, (e) => run('microtask')(e) && e.job === 'thenable job',
    /Queued when the promise created at top level, 15-resolve-with-promise\.js:11 was resolved with another promise/,
    '15 thenable job blamed on its line');
assert(r.out.some((s) => /✗ differs\. V8 queued it, with no event/.test(s.actual)), '15 unpredicted thenable job explained');
{
  const names = new Map(r.out.filter((s) => s.e.op === 'enqueue' || s.e.op === 'run' && s.e.job)
    .map((s) => [s.e.id, s.e.name]));
  const at = (op, re) => r.out.findIndex((s) => s.e.kind === 'queue' && s.e.op === op && re.test(names.get(s.e.id)));
  assert(at('run', /^thenable @ line 11/) < at('run', /tick 1/), '15 thenable job runs before tick 1');
  assert(at('run', /^adopt @ line 11/) > at('run', /tick 1/), '15 adopt job runs after tick 1');
  assert(at('enqueue', /resolved with a prom/) > at('run', /^adopt @ line 11/), '15 reaction queued by the adopt job');
  assert(at('run', /resolved with a prom/) > at('run', /tick 2/), '15 reaction runs after tick 2');
  assert(at('run', /resolved with a prom/) < at('run', /tick 3/), '15 reaction runs before tick 3');
}

r = render('01-basics');
has(r, run('nextTick'), /main script just finished/, '01 tick after main');
has(r, (e) => e.kind === 'queue' && e.op === 'enqueue' && e.queue === 'timers', /asked for 0 ms; Node uses 1 ms/, '01 clamp note');

r = render('07-starvation');
assert(r.gotchas.some((g) => /500 chained nextTick callbacks starved the loop/.test(g)), `07 starvation: ${r.gotchas}`);
has(r, run('timers'), /waiting for the chain of 500 nextTick callbacks/, '07 late timer blamed on chain');

r = render('08-keep-alive');
has(r, (e) => e.kind === 'alive' && e.what === 'loop-start', /Keeping it alive: a TCP server, a pending timer/, '08 loop start keepers');
has(r, (e) => e.kind === 'alive' && e.what === 'alive' && !e.alive, /Nothing keeps the loop alive/, '08 last check');
has(r, (e) => e.kind === 'phase' && e.phase === 'beforeExit' && e.begin, /beforeExit/, '08 beforeExit');
assert(r.out.some((s) => /a TCP server/.test(s.alive)), '08 alive panel lists server');
assert(render('08-keep-alive', 'events', { showEmpty: true }).out.some((s) => /Waiting for it now: 1 I\/O source/.test(s.phases)),
       '08 poll card counts the server');
els.showEmpty = mk();
const unrefAt = r.out.findIndex((s) => s.e.kind === 'queue' && s.e.op === 'unref');
assert(unrefAt >= 0 && /unref'd: it no longer keeps the loop alive/.test(r.out[unrefAt].explain), '08 unref step');
assert(r.out.slice(unrefAt).every((s) => !/never/.test(s.upnext) || /never unref'd|only if something else/.test(s.upnext)), '08 unref timer flagged');

r = render('09-timer-lists');
assert(r.gotchas.some((g) => /out of due order/.test(g)), `09 order gotcha: ${r.gotchas}`);
has(r, (e) => run('timers')(e) && e.id === 4, /c was due at \d+ ms, before b/, '09 c ran after b');
has(r, (e) => e.kind === 'queue' && e.op === 'enqueue' && e.queue === 'timers', /joins the existing 10 ms timer list/, '09 shared list');

r = render('10-interval-drift');
assert(r.gotchas.some((g) => /tick drifted \d+ ms/.test(g)), `10 drift gotcha: ${r.gotchas}`);
has(r, (e) => e.kind === 'queue' && e.op === 'enqueue' && e.rearm, /re-arms the timer from when this run started/, '10 drift note');
for (const s of r.out.filter((s) => run('timers')(s.e)))
  assert(/(Queued|Re-armed) at step/.test(s.explain), `10 every run visible with cause: ${s.explain}`);
assert.strictEqual(r.out.filter((s) => run('timers')(s.e)).length, 4, '10 all four interval runs shown');

r = render('11-unhandled-rejection');
has(r, (e) => e.kind === 'queue' && e.op === 'handled' && !e.late, /In time/, '11 early handled in time');
has(r, (e) => e.kind === 'queue' && e.op === 'unhandled', /your listener receives it/, '11 unhandled with listener');
has(r, (e) => e.kind === 'queue' && e.op === 'handled' && e.late, /Too late/, '11 late handler');

assert(!render('01-basics').gotchas.some((g) => /ES module/.test(g)), 'no esm gotcha in CommonJS');
assert(!render('01-basics').out.some((s) => /top-level code/.test(s.explain)), 'no module job step in CommonJS');
r = render('12-esm-order', 'events');
assert(r.gotchas.some((g) => /In an ES module, top-level promise jobs beat nextTick/.test(g)), `12 esm gotcha: ${r.gotchas}`);
// The module body is itself a microtask, queued by Node's loader.
assert(/ES module loader added your module's top-level code to the/.test(r.out[0].explain), `12 first step: ${r.out[0].explain}`);
assert(!r.out.some((s) => /differs/.test(s.actual)), '12 up next follows the microtask drain');

// Anonymous callbacks are named by their own code, with the line in the queue.
const tickEnq = r.out.findIndex((s) => s.e.kind === 'queue' && s.e.op === 'enqueue' && s.e.queue === 'nextTick');
assert(/\(\) => console\.log\('nextTick'\) added to the/.test(r.out[tickEnq].explain), r.out[tickEnq].explain);
assert(!/<anonymous>|file:\/\//.test(r.out[tickEnq].explain), `no anonymous or path: ${r.out[tickEnq].explain}`);
m.exports.go(tickEnq);
assert(/\(\) => console\.log\('nextTick'\) line 8/.test(text(els.queues.innerHTML)), text(els.queues.innerHTML));

// Every phase column explains itself, the untraced close phase included.
for (const p of ['main script', 'timers', 'poll', 'check', 'close', 'beforeExit'])
  assert(new RegExp(`<span>${p}</span><span class="help"`).test(els.phases.innerHTML), `${p} column has help`);
assert(/socket\.destroy\(\)/.test(els.phases.innerHTML), 'close help has an example');

// Predict mode: guessing the actual next callback scores a point and
// lands on that callback's step.
els.predictMode = Object.assign(mk(), { checked: true });
r = render('01-basics', 'events', { predictMode: true });
const at = r.out.findIndex((s) => /Which callback runs next\?/.test(s.upnext));
assert(at >= 0, 'predict mode offers choices');
m.exports.go(at);
const ctx = m.exports.guessCtx;
m.exports.checkGuess(ctx.actual.key, ctx.actual.name);
assert(/✓ Right/.test(text(els.explain.innerHTML)), `right guess revealed: ${text(els.explain.innerHTML)}`);
assert(/Score: 1 \/ 1/.test(text(els.explain.innerHTML)), 'score counted');
m.exports.go(at);
m.exports.checkGuess('nope', 'something else');
assert(/✗ You picked something else/.test(text(els.explain.innerHTML)), 'wrong guess revealed');
els.predictMode = Object.assign(mk(), { checked: false });

// Compare: a run matches itself; a different trace is flagged.
render('01-basics');
m.exports.setBaseline({ ...m.exports.runSummary(), at: 'now' });
assert(/✓ Same callbacks in the same order, same output/.test(text(els.compare.innerHTML)), 'self compare');
render('04-nested');
assert(/✗ Callbacks differ from #1/.test(text(els.compare.innerHTML)), `different trace: ${text(els.compare.innerHTML)}`);
m.exports.setBaseline(null);


// Timeline: one block per visible callback run, a bar per wait.
r = render('01-basics', 'events');
const tl = m.exports.TL.blocks;
const runs = r.out.filter((s) => s.e.kind === 'queue' && s.e.op === 'run').length;
assert.strictEqual(tl.filter((b) => b.cls === '').length, runs, 'a timeline block per callback run');
assert(tl.some((b) => b.cls === 'wait' && /timeout/.test(b.label)), 'waiting bar for the timer');
assert(tl.some((b) => b.cls === 'ph main'), 'main script segment');
assert(/class="tb/.test(els.tlInner.innerHTML), 'timeline rendered');

// Timing banner only on steps whose notes rest on measured durations.
r = render('05-blocking', 'events');
assert(r.out.some((s) => /Measured with tracing on/.test(s.explain)), '05 timing banner');
assert(!render('02-inside-io', 'events').out.some((s) => /Measured with tracing on/.test(s.explain)), 'no banner without timings');

// Why hasn't it run: asking about the queued timer while the main script runs.
r = render('01-basics', 'events');
const atEnq = r.out.findIndex((s) => s.e.kind === 'queue' && s.e.op === 'enqueue' && s.e.queue === 'timers');
m.exports.go(atEnq);
const clickQueued = (q, id, name) =>
  els.loopBox.onclick({ target: { closest: () => ({ dataset: { q, id: String(id), name } }) } });
clickQueued('timers', r.out[atEnq].e.id, 'timeout');
assert(/main script has not finished yet/.test(text(els.waitWhy.innerHTML)), 'why for timer: ' + text(els.waitWhy.innerHTML));
const tickAt = r.out.findIndex((s) => s.e.kind === 'queue' && s.e.op === 'enqueue' && s.e.queue === 'microtask');
m.exports.go(tickAt);
clickQueued('microtask', r.out[tickAt].e.id, 'x');
assert(/runs in queue order/.test(text(els.waitWhy.innerHTML)), 'why for microtask');
const ranAt = r.out.findIndex((s) => s.e.kind === 'queue' && s.e.op === 'done' && s.e.id === r.out[tickAt].e.id);
m.exports.go(ranAt);
assert(/not waiting any more/.test(text(els.waitWhy.innerHTML)), 'why after it ran');
els.waitWhy.onclick({ target: { closest: () => ({}) } });

// Expected output: the first wrong line is explained with Node's rule.
els.expected = Object.assign(mk(), { value: 'sync start\nsync end\npromise\nnextTick' });
render('01-basics', 'events');
m.exports.renderExpect();
const ex = text(els.expectBox.innerHTML);
assert(/Line 3: you expected promise , but nextTick was printed first/.test(ex), ex);
assert(/nextTick callbacks run before promise jobs/.test(ex), ex);
assert.strictEqual(els.outBadge.textContent, '✗');
els.expected.value = 'sync start\nsync end\nnextTick\npromise\nqueueMicrotask';
m.exports.renderExpect();
assert(/Line 6: you expected/.test(text(els.expectBox.innerHTML)) || /printed only/.test(text(els.expectBox.innerHTML)) ||
  /printed more/.test(text(els.expectBox.innerHTML)), text(els.expectBox.innerHTML));
els.expected.value = '';

// Async calls: each call is told apart, its pauses are explained, and a
// second call starting while the first is paused is flagged.
r = render('13-overlapping-calls');
assert(r.gotchas.includes('Calls to executeAsync overlapped'), `13 overlap gotcha: ${r.gotchas}`);
const act = (op) => (e) => e.kind === 'act' && e.op === op;
has(r, act('enter'), /executeAsync #2 started while executeAsync #1 was paused at await execute\(sqlQuery\) \(line 21\)/, '13 overlap at start');
has(r, act('await'), /executeAsync #1 pauses at await sleep\(100\) \(line 22\)/, '13 pause named');
has(r, act('resume'), /While executeAsync #1 was paused at await sleep\(100\).*executeAsync #2 resumed/, '13 what ran in the gap');
has(r, (e) => run('microtask')(e), /Running microtask callback resume executeAsync #2 @ line 22/, '13 resume job named after the call');
const pausedAt = r.out.findIndex((s) => act('await')(s.e));
m.exports.go(pausedAt);
assert(/executeAsync #1 line 21/.test(text(els.paused.innerHTML)), `13 paused panel: ${text(els.paused.innerHTML)}`);
const lanes = m.exports.TL.blocks;
assert(lanes.some((b) => b.cls === 'act' && b.label === 'executeAsync #2'), '13 timeline lane per call');
assert(lanes.some((b) => b.cls === 'wait' && /executeAsync #1 paused at await sleep/.test(b.title)), '13 paused bar');
// A queued callback's tooltip shows its full code and where it was queued.
const timerQueued = r.out.findIndex((s) => s.e.kind === 'queue' && s.e.op === 'enqueue' && s.e.queue === 'timers');
m.exports.go(timerQueued);
assert(/title="\(\) =&gt; \{\n {2}result = `rows for \$\{sql\}`;\n {2}complete = true;\n\}\n\nQueued in execute, at 13-overlapping-calls\.js:10"/
  .test(els.phases.innerHTML), 'queued callback tooltip');
assert(!render('03-async-await').gotchas.some((g) => /overlapped/.test(g)), 'no overlap gotcha without overlapping calls');

// An await on a plain value is enough for another call to slip in between
// a check and the write that depends on it.
r = render('14-check-then-act');
assert(r.gotchas.includes('Calls to withdraw overlapped'), `14 overlap gotcha: ${r.gotchas}`);
has(r, act('enter'), /withdraw #2 started while withdraw #1 was paused at await null \(line 12\)/, '14 second call starts in the gap');
has(r, act('resume'), /While withdraw #1 was paused at await null.*withdraw #2 started/, '14 first call told what ran in the gap');

// The call started first can finish last, so its write overwrites newer data.
r = render('17-stale-response');
assert(r.gotchas.includes('Calls to search overlapped'), `17 overlap gotcha: ${r.gotchas}`);
{
  const resumes = r.out.filter((s) => act('resume')(s.e)).map((s) => s.explain);
  assert(/^search #2 resumes/.test(resumes[0]) && /^search #1 resumes.*search #2 ran while search #1 was paused/.test(resumes[1]),
         `17 the later call resumes first: ${resumes}`);
}

// The keep-alive panel is libuv's last check, so it marks callbacks that ran
// since then instead of dropping them, and a re-armed interval is pending again.
r = render('01-basics');
assert(r.out.some((s) => /last check: when the loop started.*pending timer \(has run since\)/.test(s.alive)), '01 ran timer marked');
r = render('10-interval-drift');
{
  const i = r.out.findIndex((s) => /pending timer \(has run since\)/.test(s.alive));
  assert(r.out.slice(i).some((s) => /pending timer So/.test(s.alive)), '10 interval pending again');
}

// A .then on a settled promise is one step that queues the callback. On a
// pending promise it only registers the callback, and the settle queues it.
r = render('16-then-pending-vs-settled');
{
  const thenStep = (re) => r.out.findIndex((s) => s.e.kind === 'queue' && re.test(s.explain));
  const now = thenStep(/^\.then\(\) was called on a promise that is already fulfilled ?, so .*A: .* is added to the microtask queue right away/);
  const waits = thenStep(/^\.then\(\) was called on a promise that is still pending ?, so .*B: .* is not queued yet/);
  const settles = thenStep(/B: .* is now added to the microtask queue ?: the promise it was waiting on was just fulfilled ?by the code at line 12/);
  assert(now >= 0 && waits > now && settles > waits, `16 then steps in order: ${now} ${waits} ${settles}`);
  assert(!r.out.some((s) => s.e.op === 'then' && s.e.settled), '16 no separate step for .then on a settled promise');
  assert(/B: /.test(r.out[waits].pending) && /B: /.test(r.out[settles - 1].pending) && !/B: /.test(r.out[settles].pending),
         '16 the waiting callback is listed until the promise settles');
  const runB = r.out.find((s) => run('microtask')(s.e) && /B: /.test(s.explain));
  assert(/when the promise it waited on was fulfilled at line 12\. It was attached at step \d+/.test(runB.explain),
         `16 run names the settle as its cause: ${runB.explain}`);
}

console.log('all explanation checks passed');
