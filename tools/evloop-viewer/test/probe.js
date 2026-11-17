'use strict';

// Usage: node probe.js [name ...]. Traces each script in probes/ (or only the
// named ones) with the node running this script, replays the trace through
// the viewer and prints what the viewer cannot explain yet:
//   * user code or output that runs while no traced callback is open
//   * I/O providers and keep-alive resources the viewer has no description for
//   * errors while stepping
// Traces are written to a fresh temporary directory, printed at the end.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const env = require('./viewer-env.js');

const probes = path.join(__dirname, 'probes');
// Loaded by other probes, not run on their own.
const helpers = new Set(['helper.js', 'lib-esm.mjs']);

const html = fs.readFileSync(path.join(env.viewerDir, 'index.html'), 'utf8');
const table = /const PROVIDERS = \{([\s\S]*?)\n\};/.exec(html)[1];
const described = new Set([...table.matchAll(/\b([A-Z][A-Z0-9]*): '/g)].map((m) => m[1]));
const resourceTable = /const RESOURCES = \{([\s\S]*?)\n\};/.exec(html)[1];
const namedResources = new Set([...resourceTable.matchAll(/^\s*(\w+): \[/gm)].map((m) => m[1]));

// Events that open or close a context in which user code may run.
const kSpans = new Set(['io', 'ticks', 'microtasks', 'beforeExit']);

function analyze(file) {
  const events = JSON.parse(fs.readFileSync(file, 'utf8')).traceEvents
    .filter((e) => e.cat.split(',').includes('node.evloop'));
  const providers = new Set();
  const resources = new Set();
  const files = [];
  const open = [];
  let loopStarted = false;
  let orphanStatements = 0;
  const orphanOutput = [];
  for (const e of events) {
    const d = e.args?.data;
    if (e.name === 'io' && e.ph === 'B') providers.add(e.args.provider);
    for (const r of String(e.args?.resources ?? '').split(',').filter(Boolean)) resources.add(r.split(':')[0]);
    if (d?.op === 'source') files.push(path.basename(d.file));
    if (e.name === 'loop-start') loopStarted = true;
    if (kSpans.has(e.name) && e.ph === 'B') open.push(e.name);
    else if (kSpans.has(e.name) && e.ph === 'E') open.pop();
    else if (d?.op === 'run') open.push('run');
    else if (d?.op === 'done') open.pop();
    if (loopStarted && open.length === 0) {
      if (e.name === 'src' && d.op === 's') orphanStatements++;
      if (d?.queue === 'console') orphanOutput.push(d.text.trim());
    }
  }

  let steps = 0;
  let renderError;
  let gotchas = [];
  try {
    env.els.gran = Object.assign(env.mk(), { value: 'expr' });
    env.m.exports.load(fs.readFileSync(file, 'utf8'), path.basename(file));
    steps = env.m.exports.steps.length;
    for (let i = 0; i < steps; i++) env.m.exports.go(i);
    gotchas = env.m.exports.gotchas.map((g) => g.title);
  } catch (err) {
    renderError = err.stack.split('\n').slice(0, 2).join(' ');
  }
  return { providers, resources, files, orphanStatements, orphanOutput, steps, renderError, gotchas };
}

const wanted = process.argv.slice(2);
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'evloop-probes-'));
for (const name of fs.readdirSync(probes).sort()) {
  if (helpers.has(name)) continue;
  const base = name.replace(/\.(m?js|ts)$/, '');
  if (wanted.length && !wanted.includes(base)) continue;
  const trace = path.join(out, `${base}.json`);
  const run = spawnSync(process.execPath, [
    '--trace-event-categories', 'node.evloop',
    '--trace-event-file-pattern', trace,
    name,
  ], { cwd: probes, encoding: 'utf8', timeout: 15_000 });
  const printed = `${run.stdout}${run.stderr}`.trim().split('\n').join(' | ');
  console.log(`\n== ${base}  exit=${run.status}  output: ${printed}`);
  if (!fs.existsSync(trace)) {
    console.log('  NO TRACE');
    continue;
  }
  const r = analyze(trace);
  const undescribed = [...r.providers].filter((p) => !described.has(p));
  const unnamed = [...r.resources].filter((t) => !namedResources.has(t));
  console.log(`  steps=${r.steps}  instrumented: ${r.files.join(', ') || '(none)'}`);
  if (r.renderError) console.log(`  RENDER ERROR: ${r.renderError}`);
  if (r.providers.size) console.log(`  I/O: ${[...r.providers].join(', ')}`);
  if (undescribed.length) console.log(`  NO DESCRIPTION: ${undescribed.join(', ')}`);
  if (unnamed.length) console.log(`  NO KEEP-ALIVE NAME: ${unnamed.join(', ')}`);
  if (r.orphanStatements || r.orphanOutput.length) {
    console.log(`  OUTSIDE ANY TRACED CALLBACK: ${r.orphanStatements} statements, ` +
                `output ${JSON.stringify(r.orphanOutput)}`);
  }
  if (r.gotchas.length) console.log(`  gotchas: ${r.gotchas.join(' | ')}`);
}
console.log(`\nTraces in ${out}`);
