// Codex as an agent runtime: one long-lived `codex app-server` (JSON-RPC 2.0
// over stdio, newline-delimited). A run is one turn on one thread: fresh
// (`thread/start` in the working directory), continued (`thread/resume`),
// or branched (`thread/fork`). The server's notifications become the same
// event kinds the Pi runtime emits, so the renderer reads nothing new:
// text and reasoning deltas, tool starts and ends, questions (the server's
// own approval and user-input requests), run_end. Codex keeps its rollout
// files, login and model list; the shell only asks.
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { snapshotDir, diffSnapshots } = require('./fs-diff.cjs');

const fsp = fs.promises;
const RESPONSE_MS = 30 * 1000;
const { locate, childEnv: envWith } = require('./where.cjs');
const EXTRA_HOMES = [path.join(os.homedir(), '.codex', 'bin')];

/** The codex binary and the directories walked to find it (see where.cjs). */
let located = null;
const findCodex = () => (located ??= locate('codex', EXTRA_HOMES));
const childEnv = () => envWith(EXTRA_HOMES);

/** The guard file the canvas writes per working directory, as Codex policy:
 *  ask → the workspace sandbox, escalations asked of the person; auto → the
 *  same, with escalations decided by Codex's own reviewer (anything it turns
 *  down still comes to the person); allow → no sandbox, nothing asked. */
async function policyFor(cwd) {
  let mode = 'ask';
  try { mode = JSON.parse(await fsp.readFile(path.join(cwd, '.thoughtdag', 'guard.json'), 'utf8'))?.mode ?? 'ask'; } catch { /* default */ }
  if (mode === 'allow') return { approvalPolicy: 'never', sandbox: 'danger-full-access', approvalsReviewer: 'user' };
  return { approvalPolicy: 'on-request', sandbox: 'workspace-write', approvalsReviewer: mode === 'auto' ? 'auto_review' : 'user' };
}

// the thread id is in the rollout's file name; take the LAST UUID in the
// path in case a directory carries one of its own
const threadIdOf = (sessionPath) => {
  const all = String(sessionPath ?? '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
  return all && all.length ? all[all.length - 1] : null;
};

function createCodexRuntime({ log } = {}) {
  const say = log || (() => {});
  let proc = null;            // the app-server child
  let ready = null;           // initialize handshake
  let buf = '';
  let nextId = 1;
  const pending = new Map();  // our request id → resolve
  const runs = new Map();     // runId → run state
  const byThread = new Map(); // threadId → runId
  const serverAsks = new Map(); // question id → { rpcId, respond(answer) }
  let binPromise = null;
  const bin = () => {
    if (!binPromise) binPromise = findCodex().then((r) => { if (!r.path) { located = null; binPromise = null; } return r.path; });
    return binPromise;
  };
  /** Where the lookup walked, for the picker's "not found" note. */
  const searched = async () => (await findCodex()).searched;

  const write = (obj) => { try { proc.stdin.write(JSON.stringify(obj) + '\n'); return true; } catch { return false; } };
  const send = (method, params, timeoutMs = RESPONSE_MS) => new Promise((resolve, reject) => {
    if (!proc) return reject(new Error('codex app-server is not running'));
    lastUse = Date.now();
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`codex did not answer ${method} in ${timeoutMs / 1000}s`)); }, timeoutMs);
    pending.set(id, (msg) => { clearTimeout(timer); if (msg.error) reject(new Error(msg.error.message || `codex refused ${method}`)); else resolve(msg.result); });
    if (!write({ jsonrpc: '2.0', id, method, params })) { clearTimeout(timer); pending.delete(id); reject(new Error('codex stdin closed')); }
  });

  // The app-server retires after SERVER_IDLE_MS without a run or a request:
  // a catalog read at picker time must not pin a hundred megabytes for the
  // rest of the launch. The next run starts it again.
  const SERVER_IDLE_MS = Number(process.env.TD_AGENT_IDLE_MS) || 10 * 60 * 1000;
  let lastUse = Date.now();
  const retire = setInterval(() => {
    if (!proc || runs.size || pending.size || Date.now() - lastUse < SERVER_IDLE_MS) return;
    say('codex app-server idle; stopping it');
    try { proc.kill(); } catch { /* gone */ }
    proc = null; ready = null;
  }, 30 * 1000);
  retire.unref?.();

  const die = (reason) => {
    for (const p of pending.values()) p({ error: { message: reason } });
    pending.clear();
    for (const r of runs.values()) { r.emit({ type: 'run_error', message: reason }); r.end('exit'); }
    proc = null; ready = null;
  };

  async function ensureServer() {
    if (proc && ready) return ready;
    const b = await bin();
    if (!b) throw new Error('codex is not installed (no `codex` on PATH or in the usual places)');
    proc = spawn(b, ['app-server'], { env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    buf = '';
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        dispatch(msg);
      }
    });
    proc.stderr.on('data', (d) => say('[codex stderr] ' + d.toString().trim().slice(0, 400)));
    proc.on('error', (e) => die('spawn error: ' + e.message));
    proc.on('exit', (code, signal) => die(`codex exited (${signal || code})`));
    ready = send('initialize', { clientInfo: { name: 'thoughtdag', title: 'ThoughtDAG', version: '0.5.0' }, capabilities: null })
      .then(() => { write({ jsonrpc: '2.0', method: 'initialized', params: {} }); });
    return ready;
  }

  // the effort a turn ran at, as the rollout records it (turn_context.effort):
  // the model's own default when the canvas named none
  async function turnEffortOf(file) {
    if (!file) return null;
    try {
      const lines = (await fsp.readFile(file, 'utf8')).split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('"turn_context"')) continue;
        try { const o = JSON.parse(lines[i]); if (o.type === 'turn_context' && typeof o.payload?.effort === 'string') return o.payload.effort; } catch { /* torn line */ }
      }
    } catch { /* no file yet */ }
    return null;
  }

  // ~/.codex/config.toml `model_reasoning_effort` overrides every model's own
  // default; the picker's 'default' must name what a turn will actually use
  async function configuredEffort() {
    try {
      const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
      const m = (await fsp.readFile(path.join(home, 'config.toml'), 'utf8')).match(/^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m);
      return m ? m[1] : null;
    } catch { return null; }
  }

  const runOf = (threadId) => { const id = byThread.get(threadId); return id ? runs.get(id) : undefined; };

  // ── the server speaks: responses, notifications, and its own requests ──
  function dispatch(msg) {
    lastUse = Date.now();
    if (msg.id !== undefined && msg.method === undefined) { const p = pending.get(msg.id); if (p) { pending.delete(msg.id); p(msg); } return; }
    const params = msg.params ?? {};
    const run = runOf(params.threadId);
    if (msg.id !== undefined && msg.method) { serverRequest(msg, run); return; }
    if (!run) return;
    switch (msg.method) {
      case 'item/agentMessage/delta':
        run.text += String(params.delta ?? '');
        run.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: String(params.delta ?? '') } });
        break;
      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta':
        run.emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: String(params.delta ?? '') } });
        break;
      case 'item/started': {
        const it = params.item ?? {};
        const t = toolOf(it);
        if (t) run.emit({ type: 'tool_execution_start', toolCallId: it.id, toolName: t.name, args: t.args });
        break;
      }
      case 'item/completed': {
        const it = params.item ?? {};
        if (it.type === 'agentMessage' && typeof it.text === 'string') run.final = it.text;
        const t = toolOf(it);
        if (t) run.emit({ type: 'tool_execution_end', toolCallId: it.id, toolName: t.name, result: t.result, isError: t.isError });
        break;
      }
      case 'turn/completed': {
        const turn = params.turn ?? {};
        if (turn.status === 'failed') run.emit({ type: 'run_error', message: turn.error?.message ?? 'the turn failed' });
        run.end(turn.status === 'interrupted' ? 'aborted' : turn.status === 'failed' ? 'error' : 'end');
        break;
      }
      default: break;
    }
  }

  /** A thread item as a tool call, for the trace and the record. */
  function toolOf(it) {
    switch (it.type) {
      case 'commandExecution': return { name: 'bash', args: { command: it.command, cwd: it.cwd }, result: it.aggregatedOutput ?? null, isError: it.status === 'failed' || (typeof it.exitCode === 'number' && it.exitCode !== 0) };
      case 'fileChange': return { name: 'edit', args: { path: (it.changes ?? []).map((c) => c.path).join(', ') }, result: it.status ?? null, isError: it.status === 'failed' || it.status === 'declined' };
      case 'mcpToolCall': return { name: `${it.server}/${it.tool}`, args: it.arguments ?? {}, result: it.result ?? it.error ?? null, isError: !!it.error };
      case 'dynamicToolCall': return { name: it.tool, args: it.arguments ?? {}, result: null, isError: it.status === 'failed' };
      case 'webSearch': return { name: 'web_search', args: { query: it.query ?? '' }, result: null, isError: false };
      default: return null;
    }
  }

  // ── the server asks the person: approvals and user input ──
  function serverRequest(msg, run) {
    const reply = (result) => write({ jsonrpc: '2.0', id: msg.id, result });
    const params = msg.params ?? {};
    if (!run) {
      // nobody at the canvas for this thread: fail closed
      if (msg.method === 'item/tool/requestUserInput') return reply({ answers: {} });
      if (msg.method === 'item/permissions/requestApproval') return reply({ permissions: {}, scope: 'turn' });
      return reply({ decision: 'decline' });
    }
    const ask = (question, respond) => {
      const id = `q-${msg.id}`;
      serverAsks.set(id, { rpcId: msg.id, respond });
      run.waiting = true;
      run.emit({ type: 'question', id, ...question });
    };
    const decided = (id, outcome, value, extra) => { run.waiting = false; run.emit({ type: 'question_answered', id, outcome, value: value ?? null, ...(extra ?? {}) }); };
    // a yes/no the conversation may have settled already: `rule` names what a
    // standing allowance covers; a match is accepted for the session without asking
    const settle = (rule, title, message, respondYes) => {
      if (rule && run.allowRules?.has(rule)) { respondYes(true); run.emit({ type: 'question_answered', id: `auto-${msg.id}`, outcome: 'allowed-session', value: null, auto: true, title, message, rule }); return true; }
      return false;
    };
    const yesNo = (rule, respondYes, respondNo) => (a, id) => {
      const yes = !!a?.confirmed; const forSession = yes && a?.scope === 'session' && !!rule;
      if (forSession) run.allowRules?.add(rule);
      if (yes) respondYes(forSession); else respondNo();
      decided(id, yes ? (forSession ? 'allowed-session' : 'allowed-once') : 'rejected', null, forSession ? { rule } : undefined);
    };
    switch (msg.method) {
      case 'item/commandExecution/requestApproval': {
        const cmd = Array.isArray(params.command) ? params.command.join(' ') : String(params.command ?? '');
        const rule = cmd ? 'codex:cmd:' + cmd : null;
        const title = 'command needs approval'; const message = [params.command, params.reason].filter(Boolean).join('\n');
        const respondYes = (forSession) => reply({ decision: forSession ? 'acceptForSession' : 'accept' });
        if (settle(rule, title, message, respondYes)) return;
        return ask({ kind: 'confirm', title, message, rule, options: [], placeholder: null, prefill: null, paths: [], suggest: null },
          yesNo(rule, respondYes, () => reply({ decision: 'decline' })));
      }
      case 'item/fileChange/requestApproval': {
        const rule = 'codex:fileChange';
        const title = 'file change needs approval'; const message = [params.reason, params.grantRoot].filter(Boolean).join('\n') || 'apply the proposed file changes';
        const respondYes = (forSession) => reply({ decision: forSession ? 'acceptForSession' : 'accept' });
        if (settle(rule, title, message, respondYes)) return;
        return ask({ kind: 'confirm', title, message, rule, options: [], placeholder: null, prefill: null, paths: [], suggest: null },
          yesNo(rule, respondYes, () => reply({ decision: 'decline' })));
      }
      case 'item/permissions/requestApproval':
        return ask({ kind: 'confirm', title: 'more permissions requested', message: [params.reason, JSON.stringify(params.permissions ?? {})].filter(Boolean).join('\n'), options: [], placeholder: null, prefill: null, paths: [], suggest: null },
          (a, id) => { const yes = !!a?.confirmed; reply({ permissions: yes ? (params.permissions ?? {}) : {}, scope: 'turn' }); decided(id, yes ? 'allowed-once' : 'rejected'); });
      case 'item/tool/requestUserInput': {
        // the questions as one form; the answers go back together, keyed by
        // question id (a secret answer stays out of the record)
        const qs = (Array.isArray(params.questions) ? params.questions : []).filter((q) => q && typeof q.id === 'string');
        return ask({
          kind: 'form', title: 'request_user_input', message: qs.map((q) => q.question || q.header || '').join('\n'),
          questions: qs.map((q) => ({
            id: q.id, question: q.question || '', ...(q.header ? { header: q.header } : {}),
            options: (Array.isArray(q.options) ? q.options : []).filter((o) => o && typeof o.label === 'string').map((o) => ({ label: o.label, ...(o.description ? { description: o.description } : {}) })),
            custom: !!q.isOther || !(Array.isArray(q.options) && q.options.length), secret: !!q.isSecret,
          })),
          options: [], placeholder: null, prefill: null, paths: [], suggest: null,
        }, (a, id) => {
          const given = Array.isArray(a?.answers) ? a.answers : [];
          const answers = {};
          for (const q of qs) {
            const g = given.find((x) => x && x.id === q.id);
            const own = typeof g?.custom === 'string' && g.custom.trim() ? [g.custom.trim()] : [];
            answers[q.id] = { answers: [...(Array.isArray(g?.selected) ? g.selected.filter((x) => typeof x === 'string') : []), ...own] };
          }
          reply({ answers });
          const shown = qs.filter((q) => !q.isSecret && answers[q.id].answers.length).map((q) => `${q.header || q.question} → ${answers[q.id].answers.join(', ')}`).join('; ');
          decided(id, given.length ? 'answered' : 'cancelled', shown || null);
        });
      }
      default:
        return write({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `unsupported request ${msg.method}` } });
    }
  }

  const effortsIn = (m) => (m.supportedReasoningEfforts ?? []).map((e) => (e && typeof e === 'object' ? e.reasoningEffort : e)).filter((e) => typeof e === 'string');
  const modelEntry = (m) => ({ provider: 'codex', id: m.model ?? m.id, name: m.displayName ?? m.model ?? m.id, reasoning: true, vision: true, efforts: effortsIn(m), defaultEffort: typeof m.defaultReasoningEffort === 'string' ? m.defaultReasoningEffort : null });
  // model id → the reasoning efforts it advertises, from model/list
  const effortsByModel = new Map();
  const noteEfforts = (r) => { for (const m of r?.data ?? []) effortsByModel.set(m.model ?? m.id, effortsIn(m)); };
  // only a level the model itself advertises, in Codex's own words; anything
  // else means the model's default
  const effortFor = (model, word) => { const offered = effortsByModel.get(model); return word && offered && offered.includes(word) ? word : null; };
  // the model a run uses when the canvas named none: the server's own
  // default from model/list, not the config file's — a config can name a
  // model this CLI version cannot run, and the list only carries runnable ones
  let defaultModel = null;
  async function defaultModelId() {
    if (defaultModel) return defaultModel;
    try { const r = await send('model/list', {}); noteEfforts(r); const d = (r?.data ?? []).find((m) => m.isDefault) ?? (r?.data ?? [])[0]; defaultModel = d ? (d.model ?? d.id) : null; } catch { /* leave it to the config */ }
    return defaultModel;
  }

  return {
    available: () => bin(),

    async models() {
      const b = await bin();
      if (!b) return { installed: false, models: [], default: null, searched: await searched() };
      await ensureServer();
      const r = await send('model/list', {});
      noteEfforts(r);
      const configured = await configuredEffort();
      const models = (r?.data ?? []).filter((m) => !m.hidden).map(modelEntry).map((m) => (configured && m.efforts.includes(configured) ? { ...m, defaultEffort: configured } : m));
      const def = (r?.data ?? []).find((m) => m.isDefault);
      defaultModel = def ? (def.model ?? def.id) : defaultModel;
      return { installed: true, models, default: def ? `codex/${def.model ?? def.id}` : (models[0] ? `codex/${models[0].id}` : null) };
    },

    async run(req, onEvent) {
      const cwd = String(req.cwd || '');
      if (!cwd || !path.isAbsolute(cwd)) throw new Error('run needs an absolute cwd');
      await fsp.mkdir(cwd, { recursive: true });
      await ensureServer();
      const runId = randomUUID();
      const emit = (event) => { try { onEvent({ runId, event }); } catch { /* renderer gone */ } };
      const state = { runId, threadId: null, turnId: null, text: '', final: null, waiting: false, emit, end: null, done: null,
        // what this conversation already allowed for good (see README: `rule`)
        allowRules: new Set(Array.isArray(req.allowRules) ? req.allowRules.filter((s) => typeof s === 'string' && s.startsWith('codex:')) : []) };
      state.done = new Promise((resolve) => { state.end = (how) => { if (state.ended) return; state.ended = true; resolve(how); }; });
      runs.set(runId, state);
      void (async () => {
        const IDLE = Number(process.env.TD_AGENT_IDLE_MS) || 10 * 60 * 1000;
        let lastEvent = Date.now();
        const origEmit = state.emit;
        state.emit = (event) => { lastEvent = Date.now(); if (event.type === 'question') state.waiting = true; if (event.type === 'question_answered') state.waiting = false; origEmit(event); };
        const watchdog = setInterval(() => {
          if (state.waiting || Date.now() - lastEvent < IDLE) return;
          state.emit({ type: 'run_error', message: `no activity for ${IDLE >= 60000 ? Math.round(IDLE / 60000) + ' min' : Math.round(IDLE / 1000) + ' s'}; the turn was stopped` });
          if (state.threadId && state.turnId) send('turn/interrupt', { threadId: state.threadId, turnId: state.turnId }).catch(() => {});
          setTimeout(() => state.end('idle'), 5000);
        }, 15000);
        try {
          const policy = await policyFor(cwd);
          const model = (req.model && typeof req.model === 'object' && req.model.id ? req.model.id : null) ?? await defaultModelId();
          let thread;
          const resumeId = req.sessionPath ? threadIdOf(req.sessionPath) : null;
          if (req.forkEntryId && resumeId) thread = (await send('thread/fork', { threadId: resumeId, cwd, ...policy, ...(model ? { model } : {}) })).thread;
          else if (resumeId) thread = (await send('thread/resume', { threadId: resumeId, cwd, ...policy, ...(model ? { model } : {}) })).thread;
          else thread = (await send('thread/start', { cwd, ...policy, ...(model ? { model } : {}) })).thread;
          state.threadId = thread.id;
          byThread.set(thread.id, runId);
          state.emit({ type: 'session', sessionId: thread.id, sessionFile: thread.path ?? null, model: model ? { provider: 'codex', id: model, name: model } : null, cwd });
          const before = await snapshotDir(cwd).catch(() => null);
          const input = [{ type: 'text', text: String(req.prompt ?? ''), text_elements: [] }];
          for (const img of Array.isArray(req.images) ? req.images : []) if (img && typeof img.data === 'string') input.push({ type: 'image', url: `data:${img.mimeType};base64,${img.data}` });
          const effort = req.effort && model ? effortFor(model, req.effort) : null;
          const started = await send('turn/start', { threadId: thread.id, input, ...(model ? { model } : {}), ...(effort ? { effort } : {}) }, 60 * 1000);
          state.turnId = started?.turn?.id ?? null;
          const how = await state.done;
          const ran = await turnEffortOf(thread.path);
          if (ran) state.emit({ type: 'session', sessionId: thread.id, sessionFile: thread.path ?? null, model: model ? { provider: 'codex', id: model, name: model } : null, cwd, effort: ran });
          if (before) {
            const after = await snapshotDir(cwd).catch(() => null);
            if (after) { const d = diffSnapshots(before, after); if (d.changed.length || d.added.length || d.removed.length || d.truncated) state.emit({ type: 'fs_changes', ...d }); }
          }
          state.emit({ type: 'run_end', text: state.final ?? state.text, how });
        } catch (e) {
          state.emit({ type: 'run_error', message: e instanceof Error ? e.message : String(e) });
          state.emit({ type: 'run_end', text: state.final ?? state.text, how: 'error' });
        } finally {
          clearInterval(watchdog);
          if (state.threadId) byThread.delete(state.threadId);
          runs.delete(runId);
        }
      })();
      return runId;
    },

    abort(runId) {
      const r = runs.get(runId);
      if (!r) return false;
      // withdraw any question still open for this run, then interrupt
      for (const [id, ask] of serverAsks) { if (id.startsWith('q-')) { /* the server's own timeout covers it */ } void ask; }
      if (r.threadId && r.turnId) send('turn/interrupt', { threadId: r.threadId, turnId: r.turnId }).catch(() => {});
      return true;
    },

    answer(runId, requestId, response) {
      const ask = serverAsks.get(String(requestId));
      if (!ask || !runs.has(runId)) return false;
      serverAsks.delete(String(requestId));
      const a = response && typeof response === 'object' ? response : { confirmed: !!response };
      if (a.cancelled) { ask.respond({ confirmed: false, value: '' }, String(requestId)); return true; }
      ask.respond(a, String(requestId));
      return true;
    },

    shutdown() { clearInterval(retire); try { proc?.kill(); } catch { /* gone */ } proc = null; ready = null; },
  };
}

module.exports = { createCodexRuntime, findCodex };
