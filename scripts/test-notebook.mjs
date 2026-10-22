#!/usr/bin/env node
// Notebook material (.ipynb): what the model reads from a notebook, checked
// on a synthetic notebook that holds every kind of output the converter
// meets (stream, progress bar, long log, error, figure, table, HTML only,
// SVG, raw cell), then through the context builder: the saved outputs come
// framed as the author's record, the figures ride the image channel unless
// text only, the raw JSON never reaches a model, and an agent request gets
// the record without the no-run sentence.
//
// The record wording is the one measured on 2026-10-22 (0 invented runs in
// 24 on two models, against 4 in 12 for Jupyter's In/Out shape); the check
// below pins it so a reword is a deliberate act.
//
// Run: node scripts/test-notebook.mjs
// NB=<file.ipynb> also prints what a real notebook converts to.
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'tdag-nb-'));
const bundle = join(tmp, 'nb.mjs');
// the builder needs one helper from lib/attachments, whose upload pipeline
// reaches for the browser; the helper is copied, the rest left out
const STUBS = {
  attachments: 'export const attachmentFingerprint = (a) => `${a.name}|${a.size}|${a.content?.substring(0, 100)}`;',
};
await build({
  stdin: {
    contents: `
      export * from './lib/notebook';
      export { buildContext, recordsForAgent } from './store/context-builder';`,
    resolveDir: join(ROOT, 'src'),
    loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'silent',
  define: { 'import.meta.env.VITE_API_BASE': '""', 'import.meta.env.DEV': 'false' },
  plugins: [{
    name: 'stubs',
    setup(b) {
      b.onResolve({ filter: /\/attachments$/ }, (a) => ({ path: a.path.split('/').pop(), namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
    },
  }],
});
const nbmod = await import(pathToFileURL(bundle).href);
rmSync(tmp, { recursive: true, force: true });
const { parseNotebook, notebookMaterial, NOTEBOOK_TYPE, buildContext, recordsForAgent } = nbmod;

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok || !detail ? '' : `\n    ${detail}`}`);
};

// ── a notebook with every kind of output ────────────────────────────────
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const longLog = Array.from({ length: 300 }, (_, i) => `epoch ${i} loss ${(1 / (i + 1)).toFixed(4)}\n`);
const nb = {
  nbformat: 4, nbformat_minor: 5,
  metadata: { kernelspec: { name: 'python3', language: 'python', display_name: 'Python 3' } },
  cells: [
    { cell_type: 'markdown', metadata: {}, source: ['# Title\n', 'Some $x^2$ text.'] },
    { cell_type: 'code', execution_count: 1, metadata: {}, source: ['print("hello")'],
      outputs: [{ output_type: 'stream', name: 'stdout', text: ['hello\n'] }] },
    { cell_type: 'code', execution_count: 2, metadata: {}, source: 'for i in tqdm(range(3)): pass',
      outputs: [{ output_type: 'stream', name: 'stderr', text: '  0%|          | 0/3\r 33%|███       | 1/3\r100%|██████████| 3/3\n' }] },
    { cell_type: 'code', execution_count: 3, metadata: {}, source: 'train()',
      outputs: [{ output_type: 'stream', name: 'stdout', text: longLog }] },
    { cell_type: 'code', execution_count: 4, metadata: {}, source: '1/0',
      outputs: [{ output_type: 'error', ename: 'ZeroDivisionError', evalue: 'division by zero',
        traceback: ['\u001b[0;31m---------------------------------------------------------------------------\u001b[0m', '\u001b[0;31mZeroDivisionError\u001b[0m                         Traceback (most recent call last)', 'Cell \u001b[0;32mIn[4], line 1\u001b[0m\n\u001b[0;32m----> 1\u001b[0m \u001b[38;5;241m1\u001b[39m\u001b[38;5;241m/\u001b[39m\u001b[38;5;241m0\u001b[39m', '\u001b[0;31mZeroDivisionError\u001b[0m: division by zero'] }] },
    { cell_type: 'code', execution_count: 5, metadata: {}, source: 'plt.plot([1, 2])',
      outputs: [{ output_type: 'display_data', metadata: {}, data: { 'image/png': PNG + '\n', 'text/plain': ['<Figure size 640x480 with 1 Axes>'] } }] },
    { cell_type: 'code', execution_count: 6, metadata: {}, source: 'df',
      outputs: [{ output_type: 'execute_result', execution_count: 6, metadata: {}, data: { 'text/html': ['<table><tr><td>1</td></tr></table>'], 'text/plain': ['   a\n0  1'] } }] },
    { cell_type: 'code', execution_count: 7, metadata: {}, source: 'widget',
      outputs: [{ output_type: 'display_data', metadata: {}, data: { 'application/vnd.jupyter.widget-view+json': { model_id: 'x' }, 'text/html': '<script>alert(1)</script>' } }] },
    { cell_type: 'code', execution_count: 8, metadata: {}, source: 'svg',
      outputs: [{ output_type: 'display_data', metadata: {}, data: { 'image/svg+xml': '<svg xmlns="http://www.w3.org/2000/svg"/>', 'text/plain': '<IPython.core.display.SVG object>' } }] },
    { cell_type: 'code', execution_count: null, metadata: {}, source: 'not run yet', outputs: [] },
    { cell_type: 'raw', metadata: {}, source: 'raw text' },
  ],
};
const raw = JSON.stringify(nb);
const parsed = parseNotebook(raw);
check('parses nbformat 4: 11 cells, language from the kernel', parsed.cells.length === 11 && parsed.lang === 'python');
const { text, figures } = notebookMaterial(parsed);

check('markdown cell kept as written', text.startsWith('# Title\nSome $x^2$ text.'));
check('code cell: run number and a fenced block in the kernel language', text.includes('Cell [1]:\n```python\nprint("hello")\n```'));
check('saved output labelled as the author\'s last run', text.includes('Saved output of cell [1] (from the author\'s last run):\n```\nhello\n```'));
check('progress bar: only what the terminal showed last', text.includes('100%|██████████| 3/3') && !text.includes('33%'));
check('long log: head and tail, the cut counted', /epoch 0 loss[\s\S]*… \(220 lines omitted\) …[\s\S]*epoch 299 loss/.test(text) && !text.includes('epoch 150 '));
check('error: no terminal colour codes, the exception kept', !text.includes('\u001b') && text.includes('ZeroDivisionError: division by zero'));
check('figure: a numbered line in the text, the pixels in figures', text.includes('[figure 1: <Figure size 640x480 with 1 Axes>]') && figures.length === 1 && figures[0].mimeType === 'image/png' && figures[0].data === PNG);
check('table: its plain-text form, never the HTML', text.includes('   a\n0  1') && !text.includes('<table'));
check('HTML-only output: one line, nothing of the script', text.includes('[interactive output, not shown]') && !text.includes('<script'));
check('SVG: named, not attached', text.includes('[vector figure, not attached: <IPython.core.display.SVG object>]') && figures.length === 1);
check('a cell never run: blank run number, no output block', text.includes('Cell [ ]:\n```python\nnot run yet\n```') && !text.includes('Saved output of cell [ ]'));
check('raw cell fenced', text.includes('```\nraw text\n```'));

let threw = 0;
for (const bad of [JSON.stringify({ nbformat: 3, worksheets: [] }), '{not json', JSON.stringify({ nbformat: 4 })]) {
  try { parseNotebook(bad); } catch { threw++; }
}
check('anything but nbformat 4 is refused', threw === 3);

// ── through the context builder ─────────────────────────────────────────
const att = (renderMode) => ({
  id: 'att1', name: 'run.ipynb', type: NOTEBOOK_TYPE, size: raw.length, content: '', contentInVault: true,
  extractedText: text, figures, renderMode,
});
const node = (id, data) => ({ id, type: 'thought', position: { x: 0, y: 0 }, data: {
  question: '', response: '', responses: [''], responseIndex: 0, attachments: [], highlights: [], tokenCount: 0, ...data } });
const graph = (renderMode) => ({
  nodes: [node('m', { stepKind: 'file', attachments: [att(renderMode)] }), node('a', { question: 'What did it print?' })],
  edges: [{ id: 'e1', source: 'm', target: 'a', data: {} }],
});
const RECORD = 'the outputs below were saved when the author last ran each cell in their own kernel. They are a record, kept for reference; this conversation cannot run code. If the question needs something run, say what to run and why; do not state results you have not seen in the context.';

const full = buildContext('a', graph('full').nodes, graph('full').edges);
const nbMsgs = full.messages.filter((m) => m.content.startsWith('[Notebook: run.ipynb — '));
check('the notebook enters as one message, framed as the record (the measured wording)', nbMsgs.length === 1 && nbMsgs[0].content.startsWith(`[Notebook: run.ipynb — ${RECORD}]\n# Title`),
  JSON.stringify(full.messages.map((m) => m.content.slice(0, 80))));
check('its figures ride the image channel, each with its text stand-in', full.images.length === 1 && full.images[0].hasCompanion === true && full.imageSources[0]?.attachmentId === 'att1');
check('raw notebook JSON never reaches the model', !full.messages.some((m) => m.content.includes('"nbformat"') || m.content.includes(PNG)));
const textOnly = buildContext('a', graph('text-only').nodes, graph('text-only').edges);
check('text only: the cells still go, the figures stay home', textOnly.images.length === 0 && textOnly.messages.some((m) => m.content.startsWith('[Notebook: ')));
const agent = recordsForAgent(full.messages).find((m) => m.content.startsWith('[Notebook: '));
check('an agent request drops the no-run sentence and keeps the record', !!agent && !agent.content.includes('cannot run code') && agent.content.includes('not results of a run in this conversation') && agent.content.includes('Saved output of cell [1]'));

if (process.env.NB) {
  const real = notebookMaterial(parseNotebook(readFileSync(process.env.NB, 'utf8')));
  console.log(`\n${process.env.NB}: ${real.text.length} characters for the model, ${real.figures.length} figures`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
