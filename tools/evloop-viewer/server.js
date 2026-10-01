'use strict';

// Serves the event loop viewer and runs code through the instrumented Node
// build, returning the resulting `node.evloop` trace.
//
//   node tools/evloop-viewer/server.js [port]
//
// POST /api/run executes arbitrary code, so it only answers the viewer page
// it served itself: loopback only, exact Host and Origin, and a per-process
// token embedded in that page.

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const port = Number(process.argv[2] ?? process.env.PORT ?? 8765);
const root = __dirname;
const examplesDir = path.join(root, 'examples');
const nodeBinary = process.env.EVLOOP_NODE ??
  path.resolve(root, '..', '..', 'out', 'Release', 'node');
const token = crypto.randomBytes(24).toString('hex');
const kRunTimeoutMs = 10_000;
const kMaxOutput = 1024 * 1024;
const kMaxBody = 256 * 1024;

if (!fs.existsSync(nodeBinary)) {
  console.error(`Instrumented node not found at ${nodeBinary}.\n` +
                'Build it first (make -j8) or set EVLOOP_NODE.');
  process.exit(1);
}

const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json',
                '.js': 'text/javascript', '.md': 'text/markdown; charset=utf-8' };

let running = false;

function send(res, status, body, type = 'application/json') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(data);
}

async function listExamples() {
  const files = (await fsp.readdir(examplesDir))
    .filter((f) => /\.(c|m)?js$/.test(f)).sort();
  return Promise.all(files.map(async (name) =>
    ({ name, code: await fsp.readFile(path.join(examplesDir, name), 'utf8') })));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > kMaxBody) {
        reject(new Error('body too large'));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function capture(stream) {
  let out = '';
  stream.setEncoding('utf8');
  stream.on('data', (c) => { if (out.length < kMaxOutput) out += c; });
  return () => out.slice(0, kMaxOutput);
}

async function run({ name, code }) {
  // Keep a readable basename for the source panel; default to CommonJS.
  let base = path.basename(String(name || 'scratch.js')).replace(/[^\w.-]/g, '_');
  if (!/\.(c|m)?js$/.test(base)) base += '.js';
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'evloop-'));
  try {
    const file = path.join(dir, base);
    const traceFile = path.join(dir, 'trace.json');
    await fsp.writeFile(file, String(code));
    const started = Date.now();
    const child = spawn(nodeBinary, [
      '--trace-event-categories', 'node.evloop',
      '--trace-event-file-pattern', traceFile,
      file,
    ], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = capture(child.stdout);
    const stderr = capture(child.stderr);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, kRunTimeoutMs);
    const [exitCode, signal] = await new Promise((resolve) =>
      child.on('close', (c, s) => resolve([c, s])));
    clearTimeout(timer);
    let trace = null;
    try { trace = await fsp.readFile(traceFile, 'utf8'); } catch { /* none written */ }
    return { trace, stdout: stdout(), stderr: stderr(), exitCode, signal, timedOut,
             durationMs: Date.now() - started };
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(root, rel));
  const inRoot = file === path.join(root, 'index.html') ||
    file.startsWith(path.join(root, 'traces') + path.sep) ||
    file.startsWith(examplesDir + path.sep) ||
    file === path.join(root, 'README.md');
  if (!inRoot) return send(res, 404, { error: 'not found' });
  let data;
  try { data = await fsp.readFile(file); } catch { return send(res, 404, { error: 'not found' }); }
  if (file.endsWith('index.html'))
    data = data.toString('utf8').replace('content="__EVLOOP_TOKEN__"', `content="${token}"`);
  send(res, 200, data, types[path.extname(file)] ?? 'application/octet-stream');
}

const server = http.createServer(async (req, res) => {
  try {
    // Blocks DNS rebinding: only loopback host names are accepted.
    if (!allowedHosts.has(req.headers.host)) return send(res, 403, { error: 'bad host' });

    if (req.url === '/api/examples' && req.method === 'GET')
      return send(res, 200, await listExamples());

    if (req.url === '/api/run') {
      if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
      const origin = req.headers.origin;
      if (!origin || !allowedHosts.has(origin.replace(/^http:\/\//, '')))
        return send(res, 403, { error: 'bad origin' });
      const given = Buffer.from(String(req.headers['x-evloop-token'] ?? ''));
      const expected = Buffer.from(token);
      if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected))
        return send(res, 403, { error: 'bad token' });
      if (!String(req.headers['content-type']).startsWith('application/json'))
        return send(res, 415, { error: 'JSON only' });
      if (running) return send(res, 409, { error: 'a run is already in progress' });
      running = true;
      try {
        return send(res, 200, await run(JSON.parse(await readBody(req))));
      } finally {
        running = false;
      }
    }

    if (req.method === 'GET') return serveStatic(req, res);
    send(res, 405, { error: 'method not allowed' });
  } catch (err) {
    send(res, 500, { error: String(err?.message ?? err) });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Event loop viewer: http://127.0.0.1:${port}/`);
  console.log(`Running code with ${nodeBinary}`);
});
