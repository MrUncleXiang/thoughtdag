// The judge: a System One decision. A state and typed questions go in, a
// probability for every option comes out — the /v1/systemone contract
// TypeSafe published for Jev and the open reproductions copied. One shape,
// several backends: OpenRouter (Jev, on the key the app may already hold),
// TypeSafe directly, Cloudflare Workers AI, any self-hosted endpoint (Kev,
// Laya, Von), and the configured chat model as an uncalibrated stand-in.
// Off by default. Everything that asks the judge falls back to rules when
// no judge answers, so the app works the same without one.
import { backgroundCall } from './background-model';
import { storedProviders } from './runtime-providers';
import { toast, useUiStore } from './ui-store';
import { t, fmt } from '../i18n';

export type JudgeQuestion =
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] };

export interface JudgeAnswer {
  type: 'noul' | 'choice' | 'score';
  noul?: number;
  choice?: string;
  probabilities?: Record<string, number>;
  score?: number;
  legend?: Record<string, string>;
  confidence?: number;
}

/** 'none' = whatever OpenRouter access is saved; 'off' = no judge, every decision falls back to its rule (the former switch) */
export type JudgeProviderId = 'none' | 'openrouter' | 'typesafe' | 'cloudflare' | 'custom' | 'llm' | 'off';

export interface JudgeSettings {
  /** the switch: wanted at all (on by default); a provider still has to be reachable */
  enabled: boolean;
  provider: JudgeProviderId;
  /** the provider in use before the judge was switched off, so switching on restores it */
  prevProvider?: JudgeProviderId;
  openrouterKey: string;
  typesafeKey: string;
  cloudflareAccount: string;
  cloudflareToken: string;
  customUrl: string;
  customKey: string;
}

export interface JudgeResult {
  provider: JudgeProviderId;
  model: string;
  answers: Record<string, JudgeAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
  ms: number;
  /** a trained decision model's probabilities are calibrated; a chat model's are not */
  calibrated: boolean;
}

export const DEFAULT_JUDGE: JudgeSettings = { enabled: true, provider: 'none', openrouterKey: '', typesafeKey: '', cloudflareAccount: '', cloudflareToken: '', customUrl: '', customKey: '' };
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export const JUDGE_LABELS: Record<JudgeProviderId, string> = {
  none: '—', openrouter: 'OpenRouter · Jev', typesafe: 'TypeSafe · Jev', cloudflare: 'Cloudflare · Jev', custom: 'System One endpoint', llm: 'chat model', off: '—',
};

// ── the decisions the app asks, in one place ──
// Each is a typed question set with its thresholds spelled out, so what the
// judge decides and where the bar sits can be read here, not hunted down.

/** After an answer: is there something durable to remember, and what kind. */
export interface MemoryVerdictJudged { durable: number; category: 'preference' | 'identity' | 'project' | 'none'; categoryP: number; stated: number; covers: string | null; coversP: number; provider: JudgeProviderId; model: string; calibrated: boolean }
export async function decideMemory(question: string, response: string, existing: { id: string; text: string }[]): Promise<MemoryVerdictJudged> {
  const criteria: Record<string, string> = Object.fromEntries(existing.slice(0, 40).map((m) => [m.id, m.text.slice(0, 160)]));
  criteria.none = 'no existing entry covers this';
  const r = await judge(
    { exchange: { user: question.slice(0, 2000), assistant: response.slice(0, 2000) }, existing_entries: existing.slice(0, 40).map((m) => m.text.slice(0, 160)) },
    {
      durable: { type: 'noul', instructions: 'Does `exchange` reveal something DURABLE about the user — how they like things done, who they are, or what they are working on — that would still matter in a later, unrelated session? Not: content questions, one-off task details, general knowledge, facts about this workspace, verbatim text, credentials.' },
      category: { type: 'choice', instructions: 'If `exchange` reveals something durable about the user, which kind?', criteria: { preference: 'how they like things done: language, style, format, tools, models', identity: 'who they are: role, field, expertise, long-term research agenda', project: 'what they are working on right now', none: 'nothing durable about the user here' } },
      stated: { type: 'noul', instructions: 'Did the user state this about themselves in so many words in `exchange`, rather than it being inferred from their behaviour?' },
      covers: { type: 'choice', instructions: 'Which entry in `existing_entries`, if any, already covers the same topic as what `exchange` reveals (so an update fits better than a new entry)?', criteria },
    },
  );
  const cat = r.answers.category; const cov = r.answers.covers;
  const category = (cat?.choice ?? 'none') as MemoryVerdictJudged['category'];
  return {
    durable: r.answers.durable?.noul ?? 0, category, categoryP: cat?.probabilities?.[category] ?? 0,
    stated: r.answers.stated?.noul ?? 0,
    covers: cov?.choice && cov.choice !== 'none' ? cov.choice : null, coversP: cov?.choice ? cov.probabilities?.[cov.choice] ?? 0 : 0,
    provider: r.provider, model: r.model, calibrated: r.calibrated,
  };
}
/** Memory is written only above this bar; identity also needs the user to have said it; project facts need more. */
export const MEMORY_DURABLE_BAR = 0.6;
export const MEMORY_PROJECT_BAR = 0.7;
export const MEMORY_STATED_BAR = 0.7;

/** The move an exchange makes on the map, and how settled what it arrives at is. */
export type TakeawayKind = 'insight' | 'ruleout' | 'decision' | 'pivot' | 'open';
/** Levels of the conclusiveness score, index = level. */
export const CONCLUSIVE_LEVELS = ['speculative', 'leaning', 'definite', 'verified'] as const;
/** At or above this level a plain step's takeaway is a conclusion worth a plaque line of its own. */
export const CONCLUSIVE_SETTLED = 2;
export async function decideTakeaway(question: string, response: string): Promise<{ kind: TakeawayKind; p: number; conclusive: number; conclusiveP: number; provider: JudgeProviderId; model: string; calibrated: boolean }> {
  const r = await judge({ exchange: { user: question.slice(0, 3000), assistant: response.slice(0, 4000) } }, {
    kind: { type: 'choice', instructions: 'What kind of move does `exchange` make in the line of thinking?', criteria: {
      ruleout: 'something is ruled out, rejected or shown not to work',
      decision: 'a choice is made between alternatives, a course is settled',
      pivot: 'the direction, framing or goal changes',
      open: 'a question is raised or left unresolved, next steps are asked for',
      insight: 'an ordinary step: an explanation, a result, information, no decisive move',
    } },
    conclusive: { type: 'score', instructions: 'How settled is what `exchange` arrives at?', criteria: [
      'speculative: guesses, possibilities or questions; nothing is settled',
      'leaning: a tentative view, hedged with caveats or conditions',
      'definite: a clear conclusion, answer or decision is stated',
      'verified: the conclusion is backed by a result, test, measurement or evidence shown in the exchange',
    ] },
  });
  const a = r.answers.kind;
  const kind = (a?.choice ?? 'insight') as TakeawayKind;
  const c = r.answers.conclusive;
  const top = c?.probabilities ? Object.entries(c.probabilities).reduce((b, e) => (e[1] > b[1] ? e : b)) : null;
  const conclusive = top ? Math.max(0, Math.min(3, Number(top[0]) || 0)) : Math.max(0, Math.min(3, Math.round(c?.score ?? 1)));
  return { kind, p: a?.probabilities?.[kind] ?? 0, conclusive, conclusiveP: top ? top[1] : 0, provider: r.provider, model: r.model, calibrated: r.calibrated };
}

/** Does a question want a specific detail (excerpts help) or an overview (the dossier suffices)? */
export const DETAIL_BAR = 0.5;
export async function decideDetail(question: string): Promise<number> {
  const r = await judge({ question: question.slice(0, 1500) }, {
    detail: { type: 'noul', instructions: 'Does `question` ask for a specific detail from the past — a number, a date, a decision, a file or path, what exactly was said or done — rather than an overview or general understanding of a subject?' },
  });
  return r.answers.detail?.noul ?? 1;
}

/** "Upstream changed": does the change bear on this answer, so it should be regenerated? */
export interface StaleCase { id: string; question: string; answer: string; changes: { node: string; before: string; after: string }[] }
export const STALE_BAR = 0.5;
export async function decideStaleness(cases: StaleCase[]): Promise<Record<string, number>> {
  const state: Record<string, unknown> = {};
  const questions: Record<string, JudgeQuestion> = {};
  cases.forEach((c, i) => {
    state[`n${i}`] = {
      question: c.question.slice(0, 800),
      answer: c.answer.slice(0, 1500),
      upstream_changes: c.changes.slice(0, 4).map((ch) => ({ before: ch.before.slice(0, 400) || '(nothing recorded)', after: ch.after.slice(0, 1200) || '(removed from the context)' })),
    };
    questions[`n${i}`] = { type: 'noul', instructions: `\`n${i}.answer\` was written when the content it depended on read as \`n${i}.upstream_changes[*].before\` (opening lines); that content now reads as \`after\`. Does the change bear on the answer — would the answer need to be different now — so that it should be regenerated?` };
  });
  const r = await judge(state, questions);
  return Object.fromEntries(cases.map((c, i) => [c.id, r.answers[`n${i}`]?.noul ?? 1]));
}


/** The key the app already holds for OpenRouter (a runtime provider), if any. */
export function storedOpenRouterKey(): string {
  try {
    // the providers saved in the model picker (one storage, one reader —
    // the earlier copy here read a key that never existed)
    return storedProviders().find((p) => (p.preset === 'openrouter' || /openrouter\.ai/i.test(p.baseURL ?? '')) && p.apiKey)?.apiKey ?? '';
  } catch { return ''; }
}

export function judgeSettings(): JudgeSettings { return useUiStore.getState().judge; }

// ── degrade, never wait: one call gets this long; after a failure the judge
// is skipped for a while and every decision falls back to its rule ──
export const JUDGE_TIMEOUT_MS = 6000;
export const JUDGE_TRIP_MS = 60_000;
let tripUntil = 0;
let tripNote: string | null = null;
/** The breaker's state, for the UI: skipping the judge until when, and why. */
export function judgeTripped(): { until: number; note: string } | null { return Date.now() < tripUntil ? { until: tripUntil, note: tripNote ?? '' } : null; }
export function judgeReset(): void { tripUntil = 0; tripNote = null; }
function trip(note: string): void {
  const first = Date.now() >= tripUntil;
  tripUntil = Date.now() + JUDGE_TRIP_MS; tripNote = note;
  if (first) toast('info', fmt(t('judge.tripped'), { e: note.slice(0, 80) }), 8000);
}

/** Whether a judge is configured well enough to be asked — and answering. */
export function judgeAvailable(s: JudgeSettings = judgeSettings()): boolean {
  if (Date.now() < tripUntil) return false;
  return judgeConfigured(s);
}
/** The provider in effect: the chosen one, else the saved OpenRouter access when there is one. */
export function effectiveProvider(s: JudgeSettings = judgeSettings()): JudgeProviderId {
  if (s.provider !== 'none') return s.provider;
  // 'none' means "whatever OpenRouter access there is": a key typed into the judge's own
  // field counts as much as one saved with the interfaces (it used to be ignored until the
  // provider was picked by hand, so a pasted key seemed to do nothing)
  return s.openrouterKey || storedOpenRouterKey() ? 'openrouter' : 'none';
}

/** Whether a judge is configured, regardless of whether it is answering right now. */
export function judgeConfigured(s: JudgeSettings = judgeSettings()): boolean {
  if (s.enabled === false || s.provider === 'off') return false;
  switch (effectiveProvider(s)) {
    case 'openrouter': return !!(s.openrouterKey || storedOpenRouterKey());
    case 'typesafe': return !!s.typesafeKey;
    case 'cloudflare': return !!(s.cloudflareAccount && s.cloudflareToken);
    case 'custom': return /^https?:\/\//.test(s.customUrl);
    case 'llm': return true;
    default: return false;
  }
}

/** The judge as the host reaches it (topic labelling runs there): url,
 *  headers and model, nothing kept. Null without a judge, or with the
 *  chat-model stand-in (too slow for thousands of turns). */
export function judgeCall(s: JudgeSettings = judgeSettings()): WhyJudgeCall | null {
  if (!judgeAvailable(s) || s.provider === 'llm' || s.provider === 'none') return null;
  const w = wireFor(s, {}, {});
  const model = (w.body as { model?: string }).model;
  return { url: w.url, headers: w.headers, ...(model ? { model } : {}), ...(s.provider === 'cloudflare' ? { wrap: 'cloudflare' as const } : {}) };
}

// ── transport ──

interface Wire { url: string; headers: Record<string, string>; body: unknown; direct: boolean; unwrap?: (j: unknown) => unknown }

function wireFor(s: JudgeSettings, state: unknown, questions: Record<string, JudgeQuestion>): Wire {
  switch (effectiveProvider(s)) {
    case 'openrouter':
      return { url: 'https://openrouter.ai/api/v1/systemone', headers: { Authorization: `Bearer ${s.openrouterKey || storedOpenRouterKey()}`, 'HTTP-Referer': 'https://chenxiachan.github.io/thoughtdag/', 'X-Title': 'ThoughtDAG' }, body: { model: 'typesafe/jev-1.13', state, questions }, direct: true };
    case 'typesafe':
      return { url: 'https://api.typesafe.ai/v1/systemone', headers: { Authorization: `Bearer ${s.typesafeKey}` }, body: { model: 'jev-latest', state, questions }, direct: false };
    case 'cloudflare':
      return {
        url: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(s.cloudflareAccount)}/ai/run`,
        headers: { Authorization: `Bearer ${s.cloudflareToken}` },
        body: { model: 'typesafe/jev', input: { state, questions } }, direct: false,
        unwrap: (j) => (j && typeof j === 'object' && 'result' in j ? (j as { result: unknown }).result : j),
      };
    case 'custom':
      return { url: s.customUrl, headers: s.customKey ? { Authorization: `Bearer ${s.customKey}` } : {}, body: { model: 'jev-latest', state, questions }, direct: true };
    default:
      throw new Error('no judge configured');
  }
}

async function post(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
}

async function viaProxy(w: Wire, signal?: AbortSignal): Promise<Response> {
  return fetch(`${API_BASE}/api/judge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ url: w.url, headers: w.headers, body: w.body }), signal });
}

function normalize(raw: unknown): { model: string; answers: Record<string, JudgeAnswer>; usage?: JudgeResult['usage'] } {
  const j = (raw ?? {}) as { model?: string; answers?: Record<string, JudgeAnswer>; usage?: JudgeResult['usage']; error?: unknown };
  if (!j.answers || typeof j.answers !== 'object') throw new Error(typeof j.error === 'string' ? j.error : (j.error as { message?: string })?.message ?? 'the judge returned no answers');
  return { model: j.model ?? '', answers: j.answers, usage: j.usage };
}

/** Text as the judge can take it: a slice can halve an emoji into a lone
 *  surrogate, which the endpoints reject as invalid Unicode; control
 *  characters go the same way. Applied to every string in the state. */
export function cleanForJudge<T>(v: T): T {
  // eslint-disable-next-line no-control-regex -- the control range is the point
  if (typeof v === 'string') return v.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '') as T;
  if (Array.isArray(v)) return v.map(cleanForJudge) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, cleanForJudge(x)])) as T;
  return v;
}

/** Ask the configured judge. Throws when none is configured or the call fails. */
export async function judge(rawState: unknown, questions: Record<string, JudgeQuestion>, opts: { settings?: JudgeSettings; signal?: AbortSignal; timeoutMs?: number; force?: boolean } = {}): Promise<JudgeResult> {
  const s = opts.settings ?? judgeSettings();
  if (opts.force ? !judgeConfigured(s) : !judgeAvailable(s)) throw new Error('no judge configured');
  const state = cleanForJudge(rawState);
  const t0 = Date.now();
  if (effectiveProvider(s) === 'llm') {
    // a chat model writing JSON needs longer than a judge endpoint, but not a background call's three minutes
    const r = await llmJudge(state, questions, Math.max(opts.timeoutMs ?? 0, LLM_JUDGE_TIMEOUT_MS));
    return { provider: 'llm', model: r.model, answers: r.answers, ms: Date.now() - t0, calibrated: false };
  }
  const w = wireFor(s, state, questions);
  const signal = opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? JUDGE_TIMEOUT_MS);
  try {
    let res: Response;
    if (w.direct) {
      // a browser can reach OpenRouter and (usually) a self-hosted endpoint directly; the proxy is the fallback for CORS
      try { res = await post(w.url, w.headers, w.body, signal); }
      catch (e) { if (signal.aborted) throw e; res = await viaProxy(w, signal); }
    } else {
      res = await viaProxy(w, signal);
    }
    const text = await res.text();
    let parsed: unknown = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { throw new Error(`the judge answered ${res.status} with non-JSON`); }
    if (!res.ok) {
      const err = (parsed as { error?: unknown; errors?: { message?: string }[] });
      const msg = typeof err.error === 'string' ? err.error : (err.error as { message?: string })?.message ?? err.errors?.[0]?.message ?? `HTTP ${res.status}`;
      throw new Error(msg);
    }
    const n = normalize(w.unwrap ? w.unwrap(parsed) : parsed);
    return { provider: effectiveProvider(s), model: n.model, answers: n.answers, usage: n.usage, ms: Date.now() - t0, calibrated: true };
  } catch (e) {
    // a judge that does not answer in time, or cannot be reached, is skipped for a while: every decision has a rule to fall back on
    const msg = signal.aborted ? t('judge.timeout') : (e instanceof Error ? e.message : String(e));
    if (!opts.force) trip(msg);
    throw new Error(msg);
  }
}

// ── the chat model as a stand-in ──
// The same questions, answered by the configured model as JSON. Slower,
// costs output tokens, and its numbers are opinions, not calibrated
// probabilities — the result says so (calibrated: false).

const LLM_JUDGE_TIMEOUT_MS = 30_000;

/** The answers and the model that gave them (the background order may pass over the picked one). */
async function llmJudge(state: unknown, questions: Record<string, JudgeQuestion>, timeoutMs: number): Promise<{ answers: Record<string, JudgeAnswer>; model: string }> {
  const spec = Object.entries(questions).map(([k, q]) => {
    if (q.type === 'noul') return `- "${k}" (noul): ${q.instructions} → {"noul": p(yes) in [0,1]}`;
    if (q.type === 'choice') return `- "${k}" (choice): ${q.instructions}\n  options: ${Object.entries(q.criteria).map(([o, d]) => `${o} = ${d}`).join('; ')} → {"choice": option, "probabilities": {option: p, ...} summing to 1}`;
    return `- "${k}" (score): ${q.instructions}\n  levels (index 0..${q.criteria.length - 1}): ${q.criteria.map((d, i) => `${i} = ${d}`).join('; ')} → {"probabilities": {"0": p, ...} summing to 1}`;
  }).join('\n');
  const prompt = `You are a decision function. Read the STATE, then answer every QUESTION with probabilities only. Output ONE JSON object whose keys are the question ids and whose values follow the shapes given. No prose, no markdown fences.\n\nSTATE:\n${typeof state === 'string' ? state : JSON.stringify(state)}\n\nQUESTIONS:\n${spec}`;
  const { text, model } = await backgroundCall([{ role: 'user', content: prompt }], { timeoutMs });
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error('the model returned no JSON');
  const j = JSON.parse(m[0]) as Record<string, Record<string, unknown>>;
  const out: Record<string, JudgeAnswer> = {};
  for (const [k, q] of Object.entries(questions)) {
    const a = j[k] ?? {};
    if (q.type === 'noul') { const p = Number(a.noul ?? a.p ?? a.probability); out[k] = { type: 'noul', noul: Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0.5 }; continue; }
    const probs = (a.probabilities && typeof a.probabilities === 'object') ? a.probabilities as Record<string, number> : {};
    const keys = q.type === 'choice' ? Object.keys(q.criteria) : q.criteria.map((_, i) => String(i));
    let sum = 0; const norm: Record<string, number> = {};
    for (const key of keys) { const v = Math.max(0, Number(probs[key] ?? 0) || 0); norm[key] = v; sum += v; }
    if (sum > 0) for (const key of keys) norm[key] /= sum; else for (const key of keys) norm[key] = 1 / keys.length;
    const top = keys.reduce((b, key) => (norm[key] > norm[b] ? key : b), keys[0]);
    const confidence = keys.length > 1 ? 1 - (-keys.reduce((h, key) => h + (norm[key] > 0 ? norm[key] * Math.log(norm[key]) : 0), 0) / Math.log(keys.length)) : 1;
    if (q.type === 'choice') out[k] = { type: 'choice', choice: typeof a.choice === 'string' && keys.includes(a.choice) ? a.choice : top, probabilities: norm, confidence };
    else out[k] = { type: 'score', score: keys.reduce((e, key) => e + Number(key) * norm[key], 0), probabilities: norm, legend: Object.fromEntries(q.criteria.map((d, i) => [String(i), d])), confidence };
  }
  return { answers: out, model };
}

/** A tiny decision, for the settings page's Test button (bypasses the breaker and resets it on success). */
export async function judgeSelfTest(settings: JudgeSettings): Promise<JudgeResult> {
  const r = await judge(
    { message: 'Help! My payouts have been failing for 3 days and nobody answers.' },
    {
      urgent: { type: 'noul', instructions: 'Does `message` communicate time pressure?' },
      department: { type: 'choice', instructions: 'Which team should handle `message`?', criteria: { billing: 'payments, invoices, refunds', technical: 'bugs, outages, integrations', other: 'everything else' } },
    },
    { settings, force: true },
  );
  judgeReset();
  return r;
}
