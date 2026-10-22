import type { ContextMessage } from './api';
import { backgroundCall } from './background-model';
import { getModelsOnce } from './use-models';
import { toast, useUiStore } from './ui-store';
import { whyBridge } from './why-bridge';
import { t, fmt } from '../i18n';
import { judgeAvailable, decideMemory, MEMORY_DURABLE_BAR, MEMORY_PROJECT_BAR, MEMORY_STATED_BAR } from './judge';
import { topicsOf, TOPIC_BAR } from './topics';
import { profileLines, docLines, mergeIntoDoc, restoreDoc, addInbox, migrateLegacyMemories, CREDENTIAL_PATTERN, type ProfileKind, type FactOrigin } from './profile';

// Ambient long-term memory. The contract, agreed 2026-07 and reshaped
// 2026-09-25:
//   - the model decides what to WRITE (a cheap background judge per turn);
//   - what it writes goes to one of three places: the preferences document,
//     the identity document (both ride the system layer whole), or — for
//     project facts — the topic's dossier (merged on the next update; the
//     inbox when no topic claims it). Documents are rewritten, not appended;
//   - writes announce themselves (toast with undo): visible ≠ manual;
//   - one global switch, ON by default; the memory page is the only place
//     to curate; every dossier sentence carries its sources;
//   - paradigm machine steps never receive memories (experimental control).

/** Content type — the constitution keys admission rules off this, in CODE,
    so tuning the judge's wording can never silently move the bar. */
export type MemoryCategory = 'preference' | 'identity' | 'project';

/** The legacy fragment (folded into the documents on first use). */
export interface MemoryEntry {
  id: string;
  text: string;
  kind: 'auto' | 'manual' | 'imported';
  category?: MemoryCategory;
  project?: string;
  at: string; // ISO date
}

// ── The memory constitution (rules live here, NOT in the judge prompt) ──
//   preference  how they like things done. Free to add; a new observation
//               rewrites the line it refines (newest wins).
//   identity    who they are. Only when the user STATED it (evidence gate).
//   project     what they are doing now. Filed to the topic's dossier, where
//               it is merged with the conversations themselves; bar 0.7.
//   Never stored: product mechanics, one-off task details, verbatim blocks,
//   credentials (pattern-blocked as a code-level backstop, here at admission
//   and again in profile.ts on every line a rewrite produces).
//   The stated/inferred evidence is decided once, here, and travels with the
//   line as its provenance (profile.ts LineNote): a rewrite cannot re-decide
//   it from the rewritten words, so it keeps the pre-rewrite line's.
const SESSION_ADD_CAP = 3; // auto-writes per canvas per visit; updates free
// keyed by canvas id; cleared when the canvas is switched, so one canvas's
// three writes never silence the others and a return visit starts over (#47)
const sessionAddCounts = new Map<string, number>();
export function resetMemoryWriteCaps(): void { sessionAddCounts.clear(); }
/** The canvas a generation ran on: the cap's key, and the `from` tag on what it files. */
export interface MemoryCanvas { id: string; name: string }

/** The [Memory] context block: the two documents, or null when disabled/empty. */
export function memoryContextBlock(): ContextMessage | null {
  migrateLegacyMemories();
  const { memoryEnabled, profile } = useUiStore.getState();
  if (!memoryEnabled) return null;
  const idn = docLines(profile.identity);
  const pref = docLines(profile.preferences);
  if (!idn.length && !pref.length) return null;
  const parts: string[] = [];
  if (idn.length) parts.push(`Who they are:\n${idn.map((l) => `- ${l}`).join('\n')}`);
  if (pref.length) parts.push(`How they like things done:\n${pref.map((l) => `- ${l}`).join('\n')}`);
  return {
    role: 'user',
    content: `[Memory] Durable notes about this user, kept across sessions. Use them ONLY where relevant; never recite them, never treat them as part of the current question:\n${parts.join('\n')}`,
  };
}

/** Rough token weight of the enabled documents (panel display). */
export function memoryTokens(countTokens: (s: string) => number): number {
  const { profile } = useUiStore.getState();
  return countTokens(profileLines(profile).join('\n'));
}

// Version discipline: bump when the wording changes, and run the golden
// set first (scripts/test-memory-judge.mjs) — admission behavior must
// change by DECISION, not as a side effect of prompt tuning. The judge only
// OBSERVES and CLASSIFIES; every admission rule it must obey lives in
// admissionCheck below, where a wording drift cannot move it.
export const JUDGE_PROMPT_VERSION = 2;
const JUDGE_PROMPT =
  'You maintain a user\'s long-term memory for an AI workspace. Above is the list of EXISTING memory entries (possibly empty), then ONE exchange from the current session. ' +
  'Decide whether the exchange reveals something DURABLE about the user, and CLASSIFY it: ' +
  '"preference" = how they like things done (language, style, format, tools, models); ' +
  '"identity" = who they are (role, field, expertise, long-term research agenda); ' +
  '"project" = what they are working on right now. ' +
  'Also report evidence: "stated" if the user said it about themselves in so many words, "inferred" if you are concluding it from behavior. ' +
  'NOT memories: content questions, one-off task details, general knowledge, facts about how this workspace itself works, verbatim text blocks, credentials. ' +
  'If a new observation covers the same topic as an existing entry, prefer update over add. Be conservative: most exchanges contain nothing. ' +
  'Reply with EXACTLY one line of JSON, nothing else: {"action":"none"} or {"action":"add","category":"preference|identity|project","evidence":"stated|inferred","text":"..."} or {"action":"update","id":"...","category":"...","evidence":"...","text":"..."}. ' +
  'The text must be ONE short sentence, in the same language the user writes in.';

interface JudgeVerdict {
  action?: string;
  id?: string;
  text?: string;
  category?: string;
  evidence?: string;
}

/** The constitution, applied. Returns a rejection reason or null (= allowed). */
export function admissionCheck(
  verdict: JudgeVerdict,
  existing: { id: string; text: string }[],
  canvas: MemoryCanvas | undefined,
): string | null {
  const text = (verdict.text ?? '').trim();
  if (!text) return 'empty';
  if (CREDENTIAL_PATTERN.test(text)) return 'credential-like';
  const category = verdict.category as MemoryCategory | undefined;
  if (!category || !['preference', 'identity', 'project'].includes(category)) return 'no-category';
  // Identity is the slow-moving layer: only what the user actually said.
  if (category === 'identity' && verdict.evidence !== 'stated') return 'identity-inferred';
  if (verdict.action === 'add') {
    if (existing.some((m) => m.text === text)) return 'duplicate';
    const capKey = canvas?.id ?? '(none)';
    if ((sessionAddCounts.get(capKey) ?? 0) >= SESSION_ADD_CAP) return 'session-cap';
  }
  if (verdict.action === 'update' && !existing.some((m) => m.id === verdict.id)) return 'unknown-id';
  return null;
}

/** The documents' lines as the judge's "existing entries" (ids name the document and line). */
function existingLines(): { id: string; text: string; kind: ProfileKind }[] {
  const { profile } = useUiStore.getState();
  return [
    ...docLines(profile.identity).map((text, i) => ({ id: `identity:${i}`, text, kind: 'identity' as const })),
    ...docLines(profile.preferences).map((text, i) => ({ id: `preferences:${i}`, text, kind: 'preferences' as const })),
  ];
}

/** A project fact goes to the dossier of the topic it belongs to, else the inbox. */
async function fileProjectFact(text: string, from: string | undefined): Promise<void> {
  const bridge = whyBridge();
  if (bridge) {
    try {
      const tt = await bridge.topics();
      if (tt.topics.length) {
        let best: { id: string; name: string; p: number } | null = null;
        if (judgeAvailable()) {
          const of = await topicsOf(text, tt.topics);
          for (const tp of tt.topics) { const p = of[tp.id] ?? 0; if (p >= TOPIC_BAR && (!best || p > best.p)) best = { id: tp.id, name: tp.name, p }; }
        } else {
          const low = text.toLowerCase();
          const hit = tt.topics.find((tp) => low.includes(tp.name.toLowerCase()));
          if (hit) best = { id: hit.id, name: hit.name, p: 1 };
        }
        if (best) {
          await bridge.dossierPending(best.id, { text, ...(from ? { from } : {}) });
          toast('info', fmt(t('memory.filedToDossier'), { name: best.name, t: text.slice(0, 50) }), 8000);
          return;
        }
      }
    } catch { /* the inbox takes it */ }
  }
  const item = addInbox(text, from);
  toast('info', fmt(t('memory.filedToInbox'), { t: text.slice(0, 60) }), 8000, {
    label: t('memory.undo'),
    run: () => { const st = useUiStore.getState(); st.setMemoryInbox(st.memoryInbox.filter((i) => i.id !== item.id)); },
  });
}

/** A preference or identity fact is merged into its document; the toast can undo the rewrite. */
async function mergeProfileFact(kind: ProfileKind, text: string, origin: FactOrigin): Promise<void> {
  const { before } = await mergeIntoDoc(kind, text, origin);
  toast('info', fmt(t(kind === 'preferences' ? 'memory.mergedPreferences' : 'memory.mergedIdentity'), { t: text.slice(0, 60) }), 8000, {
    label: t('memory.undo'),
    run: () => restoreDoc(kind, before),
  });
}

/**
 * Fire-and-forget write judge, called after ordinary generations. Runs on
 * the server's default model (cheap/free tier), never the flagship pick.
 */
export function judgeMemory(question: string, response: string, canvas?: MemoryCanvas): void {
  migrateLegacyMemories();
  const { memoryEnabled } = useUiStore.getState();
  if (!memoryEnabled || question.trim().length < 8) return;
  void (async () => {
    try {
      const bg = (await getModelsOnce())?.default ?? undefined;
      const existing = existingLines();
      let verdict: JudgeVerdict;
      if (judgeAvailable()) {
        // With a judge: the DECISION is a typed one with calibrated bars
        // (durable? which kind? did the user say it? does a line cover
        // it?), and the model is called only to phrase what was admitted —
        // most exchanges never reach the model at all.
        const d = await decideMemory(question, response, existing.slice(0, 40));
        if (d.category === 'none') return;
        if (d.durable < (d.category === 'project' ? MEMORY_PROJECT_BAR : MEMORY_DURABLE_BAR)) return;
        if (d.category === 'identity' && d.stated < MEMORY_STATED_BAR) return;
        const ask = `Record the durable fact about the user that the exchange below reveals (kind: ${d.category}) as ONE short sentence in the language the user writes in. Output only the sentence.`;
        const { text: raw } = await backgroundCall([{ role: 'user', content: `${ask}\n\nExchange:\nUser: ${question.slice(0, 2000)}\nAssistant: ${response.slice(0, 2000)}` }], { prefer: [bg] });
        const text = raw.trim().split('\n').map((l) => l.trim()).find((l) => l.length > 1)?.replace(/^["“「]|["”」]$/g, '') ?? '';
        verdict = { action: d.covers ? 'update' : 'add', ...(d.covers ? { id: d.covers } : {}), text, category: d.category, evidence: d.stated >= MEMORY_STATED_BAR ? 'stated' : 'inferred' };
      } else {
        const listed = existing.slice(0, 40).map((m) => `${m.id}: ${m.text}`).join('\n') || '(none)';
        const { text: raw } = await backgroundCall([
          { role: 'user', content: `Existing memory entries:\n${listed}\n\nExchange:\nUser: ${question.slice(0, 2000)}\nAssistant: ${response.slice(0, 2000)}\n\n${JUDGE_PROMPT}` },
        ], { prefer: [bg] });
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) return;
        verdict = JSON.parse(match[0]) as JudgeVerdict;
      }
      if (verdict.action !== 'add' && verdict.action !== 'update') return;
      if (admissionCheck(verdict, existing, canvas) !== null) return;
      const text = (verdict.text ?? '').trim();
      const category = verdict.category as MemoryCategory;
      if (verdict.action === 'add') {
        const capKey = canvas?.id ?? '(none)';
        sessionAddCounts.set(capKey, (sessionAddCounts.get(capKey) ?? 0) + 1);
      }
      if (category === 'project') await fileProjectFact(text, canvas?.name);
      else await mergeProfileFact(category === 'identity' ? 'identity' : 'preferences', text, { evidence: verdict.evidence === 'stated' ? 'stated' : 'inferred', ...(canvas?.name ? { from: canvas.name } : {}) });
    } catch { /* background judge failures are silent by design */ }
  })();
}
