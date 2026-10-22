#!/usr/bin/env node
// Background calls: the plaques, ladders and labels the canvas asks a model
// for on the person's behalf. Checked on three layers, none of them reaching
// a real provider:
//   1. the proxy (server.mjs) and the plugin's own interfaces
//      (dsh/lib/index.js): a fast call's reasoning switch is a preference.
//      A mock OpenRouter refuses it for one model ("Reasoning is mandatory",
//      as z-ai/glm-5.3-flash did on 2026-10-22, with HTTP 400); the call still
//      answers and the refusal is remembered, a 503 is answered the same way
//      but not remembered, a status no request shape can change (402) is not
//      sent twice, and a caller who leaves stops the upstream request. The
//      hosted proxy (functions/api) names the model that answered.
//   2. the canvas's shared order (src/lib/background-model.ts): agents and
//      the Harness Agent never answer, the last API pick stands in while the
//      picker is on an agent, a failing model passes to the next and waits
//      behind the others afterwards, an empty answer is a failure, at most
//      three models per call; an agent never reads an image for the canvas.
//   3. the ladder (src/lib/ladder.ts, ladder-core.ts): written by whichever
//      model answered, and the sentences it chooses from leave out headings,
//      table rows and code, but keep a conclusion written as a bold line.
//
// Run: node scripts/test-background.mjs
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, copyFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0, checks = 0;
const ok = (name, cond, extra = '') => { checks++; if (!cond) failures++; console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); };
const tmp = mkdtempSync(join(tmpdir(), 'tdag-bg-'));

// ── a mock OpenRouter: one model refuses the quiet switch, one has no balance, one is overloaded for a
//    while, one never answers ──
const seen = [];
let flakyLeft = 0;
let slowClosed = 0;
const upstream = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    seen.push({ model: body.model, reasoning: body.reasoning?.enabled });
    const fail = (status, message) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message, code: status } })); };
    if (body.model === 'mandatory/model' && body.reasoning?.enabled === false) return fail(400, 'Reasoning is mandatory for this endpoint and cannot be disabled.');
    if (body.model === 'broke/model') return fail(402, 'Insufficient credits');
    if (body.model === 'flaky/model' && body.reasoning?.enabled === false && flakyLeft > 0) { flakyLeft--; return fail(503, 'upstream overloaded'); }
    if (body.model === 'slow/model') { res.on('close', () => { slowClosed++; }); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: `answer from ${body.model}` }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
// the path carries "openrouter.ai", which is how both layers recognise the gateway
const base = `http://127.0.0.1:${upstream.address().port}/openrouter.ai/v1`;
const providers = [{ name: 'OpenRouter', baseURL: base, apiKey: 'test', models: ['mandatory/model', 'quiet/model', 'broke/model', 'flaky/model', 'slow/model'] }];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const post = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', host: '127.0.0.1' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
const calls = (model) => seen.filter((s) => s.model === model);

/** `quietFailures`: how many failing quiet requests make one failed attempt (the proxy's SDK retries a 503 twice) */
async function quietSwitch(label, url, quietFailures) {
  seen.length = 0;
  const msg = [{ role: 'user', content: 'hello' }];
  let r = await post(url, { messages: msg, model: 'mandatory/model', providers, fast: true });
  ok(`${label}: a model that refuses the quiet switch still answers a fast call`, r.status === 200 && r.json.text === 'answer from mandatory/model', `${r.status} ${JSON.stringify(r.json).slice(0, 100)}`);
  ok(`${label}: quiet first, then ordinary`, JSON.stringify(calls('mandatory/model').map((c) => c.reasoning)) === '[false,true]', JSON.stringify(calls('mandatory/model')));
  seen.length = 0;
  r = await post(url, { messages: msg, model: 'mandatory/model', providers, fast: true });
  ok(`${label}: the refusal is remembered, the next fast call goes out ordinary`, r.status === 200 && JSON.stringify(calls('mandatory/model').map((c) => c.reasoning)) === '[true]', JSON.stringify(calls('mandatory/model')));
  seen.length = 0;
  r = await post(url, { messages: msg, model: 'quiet/model', providers, fast: true });
  ok(`${label}: a model that takes the switch gets one quiet request`, r.status === 200 && JSON.stringify(calls('quiet/model').map((c) => c.reasoning)) === '[false]', JSON.stringify(calls('quiet/model')));
  seen.length = 0;
  r = await post(url, { messages: msg, model: 'broke/model', providers, fast: true });
  ok(`${label}: a 402 fails once, without a second request`, r.status >= 400 && calls('broke/model').length === 1 && /402|credit/i.test(JSON.stringify(r.json)), `${r.status} ${calls('broke/model').length} request(s)`);
  seen.length = 0;
  r = await post(url, { messages: msg, model: 'quiet/model', providers });
  ok(`${label}: an ordinary call is unchanged (one request, reasoning on)`, r.status === 200 && JSON.stringify(calls('quiet/model').map((c) => c.reasoning)) === '[true]', JSON.stringify(calls('quiet/model')));
  seen.length = 0; flakyLeft = quietFailures;
  r = await post(url, { messages: msg, model: 'flaky/model', providers, fast: true });
  const flaky = calls('flaky/model').map((c) => c.reasoning);
  ok(`${label}: a 503 on the quiet request is answered by the ordinary one`, r.status === 200 && flaky[flaky.length - 1] === true, JSON.stringify(flaky));
  seen.length = 0;
  r = await post(url, { messages: msg, model: 'flaky/model', providers, fast: true });
  ok(`${label}: a 503 is not remembered, the next fast call goes quiet again`, r.status === 200 && JSON.stringify(calls('flaky/model').map((c) => c.reasoning)) === '[false]', JSON.stringify(calls('flaky/model')));
  seen.length = 0; slowClosed = 0;
  const leave = new AbortController();
  const pending = fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: msg, model: 'slow/model', providers, fast: true }), signal: leave.signal }).catch(() => null);
  await sleep(400); leave.abort(); await pending;
  for (let i = 0; i < 40 && !slowClosed; i++) await sleep(50);
  await sleep(200);
  ok(`${label}: a caller who leaves stops the upstream request, and it is not sent again`, slowClosed === 1 && calls('slow/model').length === 1, `${slowClosed} closed, ${calls('slow/model').length} sent`);
}

// ── 1a. the proxy, as a copy beside the app's node_modules (no .env, no MCP config) ──
const srvDir = join(tmp, 'srv');
await import('node:fs').then((fs) => fs.mkdirSync(srvDir));
copyFileSync(join(ROOT, 'server.mjs'), join(srvDir, 'server.mjs'));
symlinkSync(join(ROOT, 'node_modules'), join(srvDir, 'node_modules'));
const port = await freePort();
const env = { ...process.env, PORT: String(port) };
for (const k of ['ZHIPU_API_KEY', 'DASHSCOPE_API_KEY', 'OPENROUTER_API_KEY', 'DEEPSEEK_API_KEY', 'MOONSHOT_API_KEY', 'OLLAMA_MODELS']) delete env[k];
const srv = spawn(process.execPath, [join(srvDir, 'server.mjs')], { cwd: srvDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
let srvLog = ''; srv.stdout.on('data', (d) => { srvLog += d; }); srv.stderr.on('data', (d) => { srvLog += d; });
for (let i = 0; i < 100 && !/running on/.test(srvLog); i++) await new Promise((r) => setTimeout(r, 100));
try {
  await quietSwitch('proxy', `http://127.0.0.1:${port}/api/claude`, 3);
} finally { srv.kill(); }

// ── 1b. the plugin, mounted on a stand-in host ──
let apiHandler = null;
const noop = () => {};
const ctx = {
  effect: (fn) => fn(), inject: noop, on: noop,
  logger: { info: noop, warn: noop, error: noop, debug: noop },
  webServer: { register: ({ path, handler }) => { if (path.endsWith('/api')) apiHandler = handler; return noop; } },
};
const plugin = await import(pathToFileURL(join(ROOT, 'dsh', 'lib', 'index.js')).href);
await plugin.apply(ctx, { whyTools: false, whyPrompt: false });
const host = createServer((req, res) => apiHandler(req, res));
await new Promise((r) => host.listen(0, '127.0.0.1', r));
try {
  await quietSwitch('plugin', `http://127.0.0.1:${host.address().port}/thoughtdag/api/claude`, 1);
} finally { host.close(); }

// ── 1c. the hosted proxy (Cloudflare): names the model that answered ──
const hosted = await import(pathToFileURL(join(ROOT, 'functions', 'api', '[[path]].js')).href);
const askHosted = async (model) => (await hosted.onRequest({ request: new Request('http://x/api/claude', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }], model, providers }) }), params: { path: ['claude'] } })).json();
let h = await askHosted('quiet/model');
ok('hosted: the answer names its model', h.model === 'quiet/model' && h.text === 'answer from quiet/model', JSON.stringify(h));
h = await askHosted('gone/model');
ok('hosted: an unknown id answered by the fallback says so', h.model === 'mandatory/model', JSON.stringify(h));
upstream.close();

// ── 2 & 3. the canvas side, bundled with stand-ins for the browser-bound modules ──
// keyed by module name: the test and the code under test must share one instance of each
const STUBS = {
  api: `export async function llmCallAnswered(messages, images, model, opts) { return globalThis.__llm(model, messages, opts); }
            export async function llmCall(messages, images, model, opts) { return (await globalThis.__llm(model, messages, opts)).text; }`,
  'use-models': 'export async function getModelsOnce() { return globalThis.__models; }',
  'agent-runtime': "export const isAgentModel = (id) => /^(pi|codex|claude)\\//.test(id ?? '');",
  'dsh-bridge': "export const isHarnessAgentModel = (id) => !!id && (id === 'harness/agent' || id.startsWith('harness/agent/'));",
  'ui-store': `let state = { selectedModel: null, ladderModel: 'answering' }; const subs = new Set();
                 export const useUiStore = { getState: () => state, setState: (p) => { const prev = state; state = { ...state, ...p }; for (const f of subs) f(state, prev); }, subscribe: (f) => { subs.add(f); return () => subs.delete(f); } };`,
  utils: 'export const countTokens = (s) => Math.ceil(String(s).length / 4);',
};
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const bundle = join(tmp, 'bg.mjs');
await build({
  stdin: { contents: "export * from './lib/background-model'; export { buildLadder, ladderPreference } from './lib/ladder'; export { sentencesOf, buildLocalLadder, levelText } from './lib/ladder-core'; export { useUiStore } from './lib/ui-store';", resolveDir: join(ROOT, 'src'), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'silent',
  define: { 'import.meta.env.DEV': 'false' },
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /^\.\.?\/(lib\/)?(api|use-models|agents\/agent-runtime|atlas\/dsh-bridge|ui-store|utils)$/ }, (a) => ({ path: a.path.split('/').pop(), namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
  } }],
});
const bg = await import(pathToFileURL(bundle).href);
const { useUiStore } = bg;

globalThis.__models = { default: 'api/default', models: [
  { id: 'api/default' }, { id: 'api/one' }, { id: 'api/two' }, { id: 'api/three' },
  { id: 'claude/claude-code/opus' }, { id: 'harness/agent/ds/flash' },
] };
const asked = [];
let behaviour = () => 'ok';
globalThis.__llm = async (model, messages, opts) => {
  asked.push(model);
  const r = behaviour(model, messages, opts);
  if (r instanceof Error) throw r;
  return { text: r === 'ok' ? `text from ${model}` : r, model };
};

useUiStore.setState({ selectedModel: 'api/two' });
useUiStore.setState({ selectedModel: 'claude/claude-code/opus' });
let order = await bg.backgroundModels([]);
ok('order: an agent pick drops out and the last API pick stands in first', order[0] === 'api/two' && !order.some((m) => /^claude\/|^harness\/agent/.test(m)), order.join(' '));
ok('order: then the default, then the list', order.join(' ') === 'api/two api/default api/one api/three', order.join(' '));
ok('the last API pick survives a restart (kept in storage)', store.get('thoughtdag.lastApiModel') === 'api/two');
useUiStore.setState({ selectedModel: 'harness/agent/ds/flash' });
order = await bg.backgroundModels(['claude/claude-code/opus', 'gone/model', 'api/three']);
const vision = bg.apiVisionModels([{ id: 'claude/claude-code/opus', vision: true }, { id: 'harness/agent/ds/flash', vision: true }, { id: 'deepseek-flash', vision: true }, { id: 'glm-5', vision: false }]);
ok('image readers: agents and the Harness Agent are left out', JSON.stringify(vision.map((m) => m.id)) === '["deepseek-flash"]', JSON.stringify(vision));
ok('order: a preferred agent or a model the list does not know is skipped', order[0] === 'api/three' && !order.includes('gone/model'), order.join(' '));

asked.length = 0;
behaviour = (m) => (m === 'api/three' ? new Error('[api/three] Reasoning is mandatory') : 'ok');
let r = await bg.backgroundCall([{ role: 'user', content: 'x' }], { prefer: ['api/three'], fast: true });
ok('a failing model passes to the next, which answers and is named', r.model === 'api/two' && asked.join(' ') === 'api/three api/two', `${r.model} via ${asked.join(' ')}`);
order = await bg.backgroundModels(['api/three']);
ok('the model that failed waits behind the others', order[order.length - 1] === 'api/three', order.join(' '));

asked.length = 0;
behaviour = (m) => (m === 'api/two' ? '   ' : 'ok');
r = await bg.backgroundCall([{ role: 'user', content: 'x' }], { prefer: ['api/two'] });
ok('an empty answer counts as a failure', r.model === 'api/default' && asked[0] === 'api/two', `${r.model} via ${asked.join(' ')}`);

asked.length = 0;
behaviour = () => new Error('HTTP 500');
let err = null;
try { await bg.backgroundCall([{ role: 'user', content: 'x' }]); } catch (e) { err = e; }
ok('when every model fails: one error naming each, at most three tried', err instanceof bg.BackgroundCallError && err.tried.length === 3 && asked.length === 3, err?.message);

const saved = globalThis.__models;
globalThis.__models = { default: null, models: [{ id: 'claude/claude-code/opus' }] };
useUiStore.setState({ selectedModel: 'claude/claude-code/opus' });
store.delete('thoughtdag.lastApiModel');
err = null;
try { await bg.backgroundCall([{ role: 'user', content: 'x' }]); } catch (e) { err = e; }
ok('agents only: no call at all, an error with nothing tried', err instanceof bg.BackgroundCallError && err.tried.length === 0);
globalThis.__models = saved;

// ── 3. the ladder: who writes it, what it reads ──
const answer = [
  '## 一、文章为什么要区分内外？',
  '文章的结论是，内外划分让推断有明确的对象。',
  '| 组别 | 命中率 |',
  '|---|---|',
  '| A | 72% |',
  '```python',
  'print("not a sentence")',
  '```',
  '**小结**',
  '所以选网关层缓存，失效用事件通知。',
  '这样命中率最高，同时失效可控。',
].join('\n');
const sents = bg.sentencesOf(answer);
ok('sentences leave out headings, table rows, code and a bold line on its own', sents.length === 3 && !sents.some((s) => /一、|\||print|小结/.test(s)), JSON.stringify(sents));
const bolded = bg.sentencesOf('**结论：先放网关层，失效用事件通知。**\n**背景**\n网关层命中率最高。\n服务层更容易控制失效。');
ok('a conclusion written as a bold line stays, a bold title goes', bolded[0] === '结论：先放网关层，失效用事件通知。' && !bolded.includes('背景'), JSON.stringify(bolded));
ok('an answer that is only structure keeps it', bg.sentencesOf('## 第一部分的标题\n## 第二部分的标题\n| 一列 | 二列 |').length >= 2);

useUiStore.setState({ selectedModel: 'claude/claude-code/opus' });
asked.length = 0;
behaviour = (m) => (m === 'api/one' ? new Error('HTTP 400 Reasoning is mandatory') : JSON.stringify({ move: 'DECISION', topic: '网关层缓存', takeaway: '选网关层缓存，失效用事件通知', reason: '命中率最高且失效可控', evidence: [1, 2] }));
const ladder = await bg.buildLadder('缓存放哪一层？', answer, bg.ladderPreference('claude/claude-code/opus').concat(['api/one']), {});
ok('an agent answer gets a written ladder from the next model when one refuses', !!ladder && ladder.model !== 'api/one' && ladder.move === 'decision' && bg.levelText(ladder, 1).includes('网关层'), ladder ? `${ladder.model}: ${bg.levelText(ladder, 1)}` : 'null');

const local = bg.buildLocalLadder('这里有时间维度吗？', '和 SolarisNet 的 LIF 相比，最根本的区别在于时间放在哪里。后面还有一句说明。', '和 SolarisNet 的 LIF 相比');
ok('a local topic does not stop on a connective', bg.levelText(local, 0) === 'SolarisNet', bg.levelText(local, 0));

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
