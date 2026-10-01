'use strict';

// Loads the viewer script from index.html with a stub DOM.
const fs = require('fs');
const path = require('path');
const viewerDir = path.join(__dirname, '..');
const els = {};
const mk = () => ({
  innerHTML: '', textContent: '', value: '', max: 0, checked: false, disabled: false, dataset: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  addEventListener() {}, setAttribute() {}, querySelector: () => null,
  scrollTop: 0, scrollHeight: 0, clientHeight: 400, style: {},
});
global.document = { getElementById: (id) => (els[id] ??= mk()), addEventListener() {} };
global.location = { search: '' };
Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
const html = fs.readFileSync(path.join(viewerDir, 'index.html'), 'utf8');
const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
const m = new module.constructor();
m._compile(script + `\nmodule.exports = { load, go, render, checkGuess, setBaseline, runSummary,
  renderExpect, get TL() { return TL; }, get steps() { return steps; }, get gotchas() { return gotchas; }, get all() { return all; }, get guessCtx() { return guessCtx; } };`, 'viewer.js');
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&quot;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
function render(name, gran = 'stmt', opts = {}) {
  els.gran = Object.assign(mk(), { value: gran });
  for (const [k, v] of Object.entries(opts)) els[k] = Object.assign(mk(), { checked: v });
  m.exports.load(fs.readFileSync(path.join(viewerDir, 'traces', `${name}.json`), 'utf8'), name);
  const out = [];
  for (let i = 0; i < m.exports.steps.length; i++) {
    m.exports.go(i);
    out.push({
      i, e: m.exports.all[m.exports.steps[i].idx], explain: text(els.explain.innerHTML),
      upnext: text(els.upnext.innerHTML), actual: text(els.actual.innerHTML), alive: text(els.alive.innerHTML),
      phases: text(els.phases.innerHTML), why: text(els.waitWhy.innerHTML), pending: text(els.pending?.innerHTML ?? ''),
    });
  }
  return { out, gotchas: m.exports.gotchas.map((g) => g.title) };
}
module.exports = { els, mk, m, text, render, viewerDir };
