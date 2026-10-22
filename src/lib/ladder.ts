// The summary ladder, model side. Two kinds of level, ONE call per node:
//   written  L0 topic ⊂ L1 takeaway ⊂ L2 brief. The model WRITES, seeing the
//            thread the node continues, what this step adds (the title chosen,
//            the number found, the option taken) and one sentence of reason.
//            Nesting holds by construction: the topic is located inside the
//            takeaway (else the takeaway's head), the brief is the takeaway
//            followed by the reason.
//   selected L3 abstract: 3 or 4 sentences of the answer, verbatim, in order,
//            the evidence behind the written lines.
// Two other designs were tried and read badly. A model writing four nested
// texts under a "delete only" rule paraphrases (0 of 8 held). Deleting words,
// then clauses, from the abstract kept every word from the answer but the short
// levels stopped meaning anything ("一个能一句话"). A written conclusion line was
// what the plaques had before 0.5.2 and what read best, so the short levels are
// written again, now with the thread in view, and the long level is quoted. The
// plaque morphs between them by longest common subsequence (ladder-core.ts).
// Everything that needs no model (tokens, pieces, levels, the local ladder)
// is in ladder-core.ts and re-exported here.
import { llmCall, type ContextMessage } from './api';
import { useUiStore } from './ui-store';
import { backgroundCall, BACKGROUND_TIMEOUT_MS } from './background-model';
import type { Ladder, LadderItem } from '../types';
import { isCJK, sentencesOf, tokenize, budget, size, words } from './ladder-core';
import { countTokens } from '../utils';
export * from './ladder-core';

/** nodes whose ladder is being built right now (a fresh answer, a right-click, a batch) */
export const inFlight = new Set<string>();

/** The models a node's ladder asks for first: the summary-model setting when
 *  one is set, else the model that answered (who answered writes). An agent
 *  never writes one; for its answers, and whenever these fail, the shared
 *  background order decides (lib/background-model.ts). */
export function ladderPreference(answeringModel?: string | null): (string | null | undefined)[] {
  const pref = useUiStore.getState().ladderModel;
  return [pref && pref !== 'answering' ? pref : null, answeringModel];
}

const parseJson = <T,>(raw: string): T | null => { const m = /\{[\s\S]*\}/.exec(raw); try { return m ? JSON.parse(m[0]) as T : null; } catch { return null; } };

/** How much compiled context may ride along with the call. The app itself no longer sends it (the thread's plaques read
 *  as well in the 09-27 comparison and cost a fraction); the option stays for experiments (lib/ladder-lab.ts). */
export const FULL_CONTEXT_MAX_TOKENS = 24_000;
/** Share of sentences found in the parent's answer above which this answer counts as a revision of it. */
export const REVISION_SHARE = 0.4;
export const MOVES = ['insight', 'ruleout', 'decision', 'pivot', 'open'] as const;
export interface LadderOptions {
  /** the compiled conversation the answer was generated from; the call runs as one more turn of it (experiments only) */
  context?: ContextMessage[];
  /** the thread compressed with its own ladders (lib/ladder-context.ts): the plaques already on the map */
  thread?: string;
  /** the direct parent's answer, to mark which sentences of this answer are the same and which changed */
  parentAnswer?: string;
}
const normSentence = (x: string) => x.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const str = (v: unknown): string => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
const END_PUNCT = /[。.!?！？；;，,]+$/;
/** a written level as free-text items: one per word, carrying its trailing space (the local ladder's convention) */
const free = (text: string, lang: 'zh' | 'en'): LadderItem[] => tokenize(text, lang).map((t) => t.t + (t.space ? ' ' : ''));

/** Build a node's ladder from its exchange, seeing the thread it continues, on the first preferred model that
 *  answers. Null when the answer is too short or the reply is unusable; throws BackgroundCallError when no
 *  model answered at all. */
export async function buildLadder(question: string, response: string, prefer: (string | null | undefined)[] = [], opts: LadderOptions = {}): Promise<Ladder | null> {
  const lang: 'zh' | 'en' = isCJK(question + response.slice(0, 200)) ? 'zh' : 'en';
  const L = lang === 'zh' ? 'Chinese' : 'English';
  const why = (r: string): null => { if (import.meta.env.DEV) console.warn('[ladder] no ladder:', r, question.slice(0, 40)); return null; };
  const sents = sentencesOf(response);
  if (sents.length < 2) return why('fewer than two sentences');
  // ── the thread: is this answer a revision of the parent's? which sentences are new? ──
  const parentSet = opts.parentAnswer ? new Set(sentencesOf(opts.parentAnswer).map(normSentence)) : null;
  const same = parentSet ? sents.map((x) => parentSet.has(normSentence(x))) : sents.map(() => false);
  const revision = !!parentSet && sents.length > 0 && same.filter(Boolean).length / sents.length >= REVISION_SHARE;
  const useFull = !!opts.context?.length && countTokens(opts.context.map((m) => m.content).join('\n')) <= FULL_CONTEXT_MAX_TOKENS;
  const contextMode: Ladder['context'] = useFull ? 'full' : opts.thread ? 'thread' : 'none';
  // ── the call: write the short levels, point at the evidence ──
  const b = budget(lang);
  const numbered = sents.map((x, i) => `${i}${revision ? (same[i] ? ' [same as before]' : ' [changed]') : ''}: ${x}`).join('\n');
  // the plaques already on the map ride along in both modes: they are what the new line must not repeat and whose terms it should reuse
  const threadBlock = opts.thread ? `Plaques already on the map along this thread, oldest first (each earlier step in its own words):\n${opts.thread}\n\n` : '';
  const adds = contextMode === 'none'
    ? 'what this step established'
    : 'what THIS step ADDS to the thread (its new conclusion, decision, correction or step), not what the earlier plaques already say';
  const revNote = revision ? ' This answer reworks the previous one: sentences marked [same as before] appear there verbatim; the takeaway and the evidence should follow the sentences marked [changed], they are what this step did.' : '';
  const prompt = `${threadBlock}Below are the numbered sentences of ${contextMode === 'full' ? 'the answer you just gave' : 'an answer'} to the question. Compress this step for a map plaque that stays legible while zooming: the reader sees the topic first, then the takeaway, then the brief, then the evidence. Output only JSON:\n{"move":"INSIGHT|RULEOUT|DECISION|PIVOT|OPEN","topic":"...","takeaway":"...","reason":"...","evidence":[sentence numbers]}\n\n- move: the epistemic move. INSIGHT = learned or established something; RULEOUT = excluded an option; DECISION = chose among options; PIVOT = changed direction; OPEN = raised a question or left something unresolved.\n- takeaway: ONE ${L} sentence of at most ${b.takeaway} ${b.unit} stating ${adds}: the conclusion first, then its key qualifier, packed like a headline. Name the thing itself (the title chosen, the number found, the option taken), not the activity ("discussed X", "proposed three options"). A reader scanning these lines down the thread should see how the thinking progressed. Reuse the terms of the plaques above where they fit. Never use dash characters (—, –, -) inside topic, takeaway or reason; use commas or colons.\n- topic: the subject of the takeaway as a bare noun phrase of at most ${b.topic} ${b.unit}, copied VERBATIM from inside the takeaway.\n- reason: ONE more ${L} sentence of at most ${b.brief - b.takeaway} ${b.unit} that reads on from the takeaway and gives its main reason, condition or consequence; do not restate the takeaway.\n- evidence: 3 or 4 sentence numbers, ascending, whose verbatim text backs the takeaway and the reason; prefer sentences that state a result over sentences that set up or list.${revNote}\n\nQuestion:\n${question.slice(0, 1500)}\n\nSentences:\n${numbered.slice(0, 12000)}`;
  const messages: ContextMessage[] = useFull
    ? [...opts.context!, { role: 'assistant', content: response }, { role: 'user', content: prompt }]
    : [{ role: 'user', content: prompt }];
  type Out = { move?: unknown; topic?: unknown; takeaway?: unknown; reason?: unknown; evidence?: unknown };
  const first = await backgroundCall(messages, { prefer, fast: true });
  // the model that answered writes the whole ladder: the correction below continues its own conversation
  const model = first.model;
  let out = parseJson<Out>(first.text);
  let takeaway = str(out?.takeaway).replace(END_PUNCT, '');
  if (!takeaway) {
    messages.push({ role: 'assistant', content: JSON.stringify(out ?? {}) }, { role: 'user', content: 'Rejected: "takeaway" is missing or empty. Return the JSON again with all five fields filled.' });
    out = parseJson<Out>(await llmCall(messages, undefined, model, { fast: true, timeoutMs: BACKGROUND_TIMEOUT_MS }).catch(() => ''));
    takeaway = str(out?.takeaway).replace(END_PUNCT, '');
  }
  if (!takeaway) return why('no takeaway: ' + JSON.stringify(out).slice(0, 120));
  const reason = str(out?.reason).replace(END_PUNCT, '');
  const mv = str(out?.move).toLowerCase() as Ladder['move'];
  const move = mv && (MOVES as readonly string[]).includes(mv) ? mv : undefined;
  // ── the evidence: the model's sentence numbers, else the sentences closest to what it wrote ──
  const nums = (a: unknown): number[] => { const flat: unknown[] = []; const walk = (v: unknown) => { if (Array.isArray(v)) v.forEach(walk); else flat.push(v); }; walk(a ?? []); return [...new Set(flat.map((x) => typeof x === 'string' && /^\d+$/.test(x.trim()) ? Number(x) : x).filter((x): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < sents.length))].sort((x, y) => x - y); };
  let chosen = nums(out?.evidence).slice(0, 4);
  if (!chosen.length) {
    const key = new Set(words(takeaway + reason, lang));
    chosen = sents.map((s, i) => { const ws = words(s, lang); return { i, hit: ws.filter((w) => key.has(w)).length / Math.sqrt(Math.max(4, ws.length)) }; })
      .sort((x, y) => y.hit - x.hit).slice(0, 3).map((x) => x.i).sort((x, y) => x - y);
  }
  const abstract = chosen.map((i) => sents[i]).join(lang === 'zh' ? '' : ' ');
  const tokens = tokenize(abstract, lang);
  if (tokens.length < 4) return why('abstract too short');
  // ── the written levels, nested by construction ──
  const takeTok = tokenize(takeaway, lang);
  const takeItems = takeTok.map((t) => t.t + (t.space ? ' ' : ''));
  const briefItems = reason ? free(`${takeaway}${lang === 'zh' ? '。' : '. '}${reason}`, lang) : [...takeItems];
  // the topic: the model's phrase located inside the takeaway, else the takeaway's head within budget
  // the topic: the model's phrase located inside the takeaway (a run of its words, punctuation not at the ends); else
  // the phrase as the model wrote it when it is short (the morph aligns whatever overlaps); else the takeaway's first clause
  const topicText = str(out?.topic).replace(END_PUNCT, '').replace(/^[「《"“(]+|[」》"”)]+$/g, '');
  const want = normSentence(topicText);
  const PUNCT = /^[\p{P}\p{S}]+$/u;
  let topicItems: LadderItem[] = [];
  if (want) { for (let w = Math.min(12, takeTok.length); w >= 1 && !topicItems.length; w--) for (let i = 0; i + w <= takeTok.length; i++) { const run = takeTok.slice(i, i + w); if (PUNCT.test(run[0].t) || PUNCT.test(run[w - 1].t)) continue; if (normSentence(run.map((t) => t.t).join('')) === want) { topicItems = run.map((t) => t.t + (t.space ? ' ' : '')); break; } } }
  if (!topicItems.length && topicText && size(topicText, lang) <= b.topic * 2) topicItems = free(topicText, lang);
  if (!topicItems.length) { let acc = ''; for (const t of takeTok) { if (PUNCT.test(t.t) && topicItems.length) break; if (size(acc + t.t, lang) > b.topic && topicItems.length) break; topicItems.push(t.t + (t.space ? ' ' : '')); acc += t.t; } }
  return { tokens, abstract, sentences: chosen, brief: briefItems, takeaway: takeItems, topic: topicItems, ...(model ? { model } : {}), context: contextMode, ...(revision ? { revision: true } : {}), ...(move ? { move } : {}) };
}
