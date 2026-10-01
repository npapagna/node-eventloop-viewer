'use strict';

// Usage: node cdp.js <url> <out-prefix> [js-to-eval-before-each-shot ...]
// Drives headless Chrome over the DevTools protocol: reports page errors,
// then takes one screenshot per script argument. Set CHROME to the browser
// binary when it is not at the default macOS path, and WIDTH/HEIGHT to
// change the 1440x1300 viewport.
const { spawn } = require('child_process');
const fs = require('fs');
const [url, prefix, ...scripts] = process.argv.slice(2);
const width = +(process.env.WIDTH ?? 1440);
const height = +(process.env.HEIGHT ?? 1300);
const chromePath = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9333',
  `--user-data-dir=${prefix}-profile`, `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch('http://127.0.0.1:9333/json')).json()).find((t) => t.type === 'page'); } catch { /* Not up yet. */ }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.onopen = r);
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') {
      const details = msg.params.exceptionDetails;
      console.log('PAGE ERROR:', details.exception?.description ?? details.text);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error')
      console.log('CONSOLE ERROR:', msg.params.args.map((a) => a.value ?? a.description).join(' '));
  };
  const send = (method, params = {}) => new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await send('Page.navigate', { url });
  await sleep(2500);
  let n = 0;
  for (const js of scripts.length ? scripts : ['0']) {
    const r = await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) console.log('EVAL ERROR:', r.result.exceptionDetails.exception?.description);
    else if (r.result?.result?.value !== undefined && r.result.result.value !== 0)
      console.log('EVAL:', JSON.stringify(r.result.result.value).slice(0, 400));
    await sleep(400);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(`${prefix}-${++n}.png`, Buffer.from(shot.result.data, 'base64'));
  }
  ws.close(); chrome.kill();
})().catch((e) => { console.error(e); chrome.kill(); });
