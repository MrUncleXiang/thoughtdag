// The summary ladder, pure part: no app imports, so it runs in a Web Worker
// as well as on the main thread. One node, four nested texts that stay
// legible at every zoom: topic ⊂ takeaway ⊂ brief ⊂ abstract, where "⊂"
// means the shorter level is the longer one with words deleted, so a plaque
// can morph between levels word by word and the shorter level's words stay
// in darker ink inside the longer one. Selection by a model lives in
// ladder.ts; the local ladder of an older node (no model) is built here.
import type { Ladder, LadderItem, LadderToken } from '../types';

export const LADDER_LEVELS = ['topic', 'takeaway', 'brief', 'abstract'] as const;
export type LadderLevel = 0 | 1 | 2 | 3;
/** canvas-space font size per level; on screen it is × zoom */
/** canvas-space font size per level; on screen it is × zoom. With HANDOFF_PX 12 (+1.2 hysteresis) the
 *  bands inside the map tier are roughly L1 0.34–0.54, L2 0.54–0.74, L3 0.74–0.9, then the card unfolds;
 *  text at a handoff is ~16 px on screen (was 13: the user found it small). */
export const LEVEL_FONT: Record<LadderLevel, number> = { 0: 72, 1: 48, 2: 30, 3: 22 };
/** a level takes over when ITS text reaches this many pixels on screen */
export const HANDOFF_PX = 15;
export const HANDOFF_HYST = 1.2;
/** nodes whose ladder is being built right now (a fresh answer, or a backfill); the offer skips them */
/** a local ladder costs nothing, so every answer gets one, a one-liner included: its levels coincide and the plaque
 *  still zooms (model ladders keep SUMMARY_MIN_CHARS); 200 left the short turns of a canvas as static plaques */
export const LOCAL_LADDER_MIN_CHARS = 1;

export const isCJK = (s: string): boolean => /[぀-ヿ㐀-鿿]/.test(s);
/** markdown markers off, line structure kept (one pass over the whole answer, not one per sentence) */
const cleanMd = (s: string): string => s
  .replace(/\[([^\]]+)\]\((?:https?:)?[^)]*\)/g, '$1').replace(/\(?https?:\/\/\S+\)?/g, '')
  .replace(/\*\*|__|`|^#+[ \t]*|^[ \t]*[-*•][ \t]+|^[ \t]*\d+[.)][ \t]+/gm, '')
  // single-marker emphasis (*word*, _word_) at word edges; a lone leading asterisk was showing on plaques
  .replace(/(^|[\s(（])[*_](?=\S)/g, '$1').replace(/(?<=\S)[*_](?=$|[\s,.;:!?)，。；：！？）])/g, '')
  .replace(/[ \t]+/g, ' ');
/** the answer as sentences, markdown stripped */
export function sentencesOf(response: string): string[] {
  const split = (s: string) => cleanMd(s).split(/\n+|(?<=[。！？；])|(?<=[.!?])\s+(?=[A-Z"“])/).map((x) => x.trim()).filter((x) => x.length >= 4);
  const text = response.replace(/\r/g, '');
  const prose = split(proseLines(text));
  // an answer that is all headings and tables still has to say something
  return prose.length >= 2 ? prose : split(text);
}
/** The answer without its structure lines: headings (a "## " line, or a bold line with nothing else that does
 *  not end like a sentence), table rows, code inside fences. As sentences they read as titles where a claim is
 *  wanted: a plaque saying "一、文章为什么要区分内外", evidence that is a table row (seen on agent answers,
 *  2026-10-22). A bold line that ends like a sentence is the answer's own conclusion and stays. */
function proseLines(s: string): string {
  let fenced = false;
  return s.split('\n').filter((line) => {
    const t = line.trim();
    if (/^(```|~~~)/.test(t)) { fenced = !fenced; return false; }
    if (fenced) return false;
    if (/^#{1,6}\s/.test(t)) return false;
    if (/^\|.*\|$/.test(t) || /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(t)) return false;
    const bold = /^(\*\*|__)([^*_\n]+)(\*\*|__)[:：]?$/.exec(t);
    return !bold || /[。！？；.!?;]$/.test(bold[2].trim());
  }).join('\n');
}
// Constructing an Intl.Segmenter costs milliseconds; segmenting with one costs microseconds. Building one per call
// made a local ladder take half a second and folding a canvas of two hundred nodes take minutes (0.5.2).
const SEGMENTERS: Partial<Record<'zh' | 'en', Intl.Segmenter>> = {};
const segmenter = (lang: 'zh' | 'en'): Intl.Segmenter => (SEGMENTERS[lang] ??= new Intl.Segmenter(lang === 'zh' ? 'zh' : 'en', { granularity: 'word' }));
export function tokenize(text: string, lang: 'zh' | 'en'): LadderToken[] {
  const seg = segmenter(lang);
  const out: LadderToken[] = [];
  for (const { segment } of seg.segment(text)) {
    if (/^\s+$/.test(segment)) { if (out.length) out[out.length - 1].space = true; continue; }
    out.push({ t: segment });
  }
  return out;
}
const latinEnd = (t: string) => /[A-Za-z0-9]$/.test(t);
const latinStart = (t: string) => /^[A-Za-z0-9(["“]/.test(t);
const closing = (t: string) => /^[,.;:!?)\]”」。，、；：！？]/.test(t);
/** whether a space belongs between two neighbouring pieces */
const QUOTE = /^["“”'‘’]$/;
export const needsSpace = (prev: string, prevSpace: boolean | undefined, next: string): boolean => {
  // a quote opens or closes: only the source text knows which, so its own whitespace decides
  if (QUOTE.test(next) || QUOTE.test(prev)) return !!prevSpace;
  return (latinEnd(prev) && latinStart(next)) || (!!prevSpace && !closing(next) && (latinEnd(prev) || latinStart(next)));
};
/** a level's pieces in order: {text, i} where i is the abstract token index, or -1 for glue or free text */
export function pieces(ladder: Ladder, level: LadderLevel): { text: string; i: number; space?: boolean }[] {
  if (level === 3) return ladder.tokens.map((tk, i) => ({ text: tk.t, i, space: tk.space }));
  const items = ladder[LADDER_LEVELS[level] as 'topic' | 'takeaway' | 'brief'];
  return items.map((it) => typeof it === 'number' ? { text: ladder.tokens[it]?.t ?? '', i: it, space: ladder.tokens[it]?.space } : { text: it, i: -1 });
}
export interface LadderPiece { text: string; id: string; space?: boolean }
const norm = (t: string) => t.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
/** longest common subsequence of two token lists (by normalised text): pairs of indices */
function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length, m = b.length; if (!n || !m) return [];
  const dp = new Uint16Array((n + 1) * (m + 1)); const W = m + 1;
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * W + j] = a[i] && a[i] === b[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
  const out: [number, number][] = []; let i = 0, j = 0;
  while (i < n && j < m) { if (a[i] && a[i] === b[j]) { out.push([i, j]); i++; j++; } else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) i++; else j++; }
  return out;
}
/** Every level's pieces with ids that persist across levels: a word that
 *  survives from one level to the next keeps its id, so the plaque can slide
 *  it into place. Nested ladders align by token index, free-text levels (the
 *  local ladder of an older node) by longest common subsequence. */
export function ladderPieces(ladder: Ladder): LadderPiece[][] {
  const out: LadderPiece[][] = [];
  const top = pieces(ladder, 3).map((p) => ({ text: p.text, id: `a${p.i}`, space: p.space }));
  out[3] = top;
  for (const level of [2, 1, 0] as LadderLevel[]) {
    const above = out[level + 1];
    const cur = pieces(ladder, level);
    const byIndex = cur.every((p) => p.i >= 0 || p.text.length <= 12) && cur.some((p) => p.i >= 0);
    const ids: string[] = new Array(cur.length).fill('');
    if (byIndex) {
      const aboveIds = new Set(above.map((p) => p.id));
      cur.forEach((p, n) => { if (p.i >= 0 && aboveIds.has(`a${p.i}`)) ids[n] = `a${p.i}`; });
    } else {
      for (const [ci, ai] of lcs(cur.map((p) => norm(p.text)), above.map((p) => norm(p.text)))) ids[ci] = above[ai].id;
    }
    out[level] = cur.map((p, n) => ({ text: p.text, id: ids[n] || `f${level}_${n}`, space: p.space }));
  }
  return out;
}

export function levelText(ladder: Ladder, level: LadderLevel): string {
  const ps = pieces(ladder, level); let s = '';
  ps.forEach((p, n) => { if (n > 0 && needsSpace(ps[n - 1].text, ps[n - 1].space, p.text)) s += ' '; s += p.text; });
  return s.trim();
}
/** Level budgets. The takeaway got 18 characters while it was cut from the answer; written, it carries the conclusion
 *  and its key qualifier the way the pre-0.5.2 lines did (the person preferred those), so it may run to a short line. */
export const budget = (lang: 'zh' | 'en') => lang === 'zh' ? { brief: 80, takeaway: 28, topic: 6, unit: 'characters' } : { brief: 40, takeaway: 14, topic: 3, unit: 'words' };
export const size = (s: string, lang: 'zh' | 'en'): number => lang === 'zh' ? [...s.replace(/[\s\p{P}\p{S}]/gu, '')].length : s.split(/\s+/).filter((w) => /\w/.test(w)).length;

/** Which level is legible at this zoom: the deepest whose on-screen font is at least HANDOFF_PX, with hysteresis around the current level. */
export function pickLevel(zoom: number, current: LadderLevel | null): LadderLevel {
  let best: LadderLevel = 0;
  for (const k of [0, 1, 2, 3] as LadderLevel[]) {
    const px = LEVEL_FONT[k] * zoom;
    const need = current === null ? HANDOFF_PX : k > current ? HANDOFF_PX + HANDOFF_HYST : k === current ? HANDOFF_PX - HANDOFF_HYST : HANDOFF_PX;
    if (px >= need) best = k;
  }
  return best;
}

const CONCLUSION_MARK = /^(结论|所以|因此|总之|简言之|一句话|答案是|建议|So|Therefore|In short|The answer|Bottom line|Decision|Verdict)/i;
const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'is', 'are', 'and', 'or', 'that', 'this', 'it', 'for', 'on', 'with', 'as', 'be', '的', '了', '是', '在', '和', '与', '或', '这', '那', '就', '也', '都', '而', '及']);
// Overlap scoring never touches the segmenter: dictionary word-breaking of Chinese costs tens of microseconds a
// character, and scoring runs over every sentence of the answer. Character bigrams (zh) and letter runs (en) do.
export const words = (text: string, lang: 'zh' | 'en'): string[] => {
  if (lang === 'zh') { const s = text.replace(/[\s\p{P}\p{S}]/gu, ''); const out: string[] = []; for (let i = 0; i + 1 < s.length; i++) out.push(s.slice(i, i + 2)); return out; }
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));
};
/** An older node's ladder without any model: the takeaway and topic it already
 *  has, and the answer's own sentences chosen by overlap with that takeaway
 *  (brief = the best one, abstract = the best three or four in order). Instant,
 *  offline, a little looser than a selected ladder; the plaque morphs by LCS. */
/** words that join or lead into a phrase but do not name anything: they never open or close a local topic */
const GLUE = /^(和|与|跟|及|并|而|而且|并且|所以|因此|因为|但|但是|不过|然而|那么|其实|首先|其次|然后|最后|总之|另外|此外|比如|例如|如果|当|在|对|把|从|关于|就是|是|的|了|也|都|就|and|or|but|so|because|then|also|however|first|finally|for|in|on|of|to|the|a|an|this|that|with|about|if|when|is|are)$/i;

export function buildLocalLadder(question: string, response: string, takeaway?: string | null, topic?: string | null): Ladder | null {
  const lang: 'zh' | 'en' = isCJK(question + response.slice(0, 200)) ? 'zh' : 'en';
  const sents = sentencesOf(response);
  // one sentence is a ladder too: its levels coincide, and the plaque still zooms
  if (!sents.length) return null;
  const key = new Set(words(takeaway ?? question, lang));
  const b = budget(lang);
  const scored = sents.map((text, i) => {
    const ws = words(text, lang); const hit = ws.filter((w) => key.has(w)).length;
    const len = size(text, lang);
    let score = hit / Math.sqrt(Math.max(4, ws.length)) + (i === 0 ? 0.25 : 0) + (CONCLUSION_MARK.test(text) ? 0.5 : 0);
    if (len < 6) score -= 0.6; if (len > b.brief * 1.6) score -= 0.3;
    return { i, text, score, len };
  });
  const top = [...scored].sort((x, y) => y.score - x.score).slice(0, 4).sort((x, y) => x.i - y.i);
  const abstract = top.map((t) => t.text).join(lang === 'zh' ? '' : ' ');
  // tokens sentence by sentence (one segmenter pass each), remembering where each sentence starts
  const tokens: LadderToken[] = []; const startOf = new Map<number, number>(); const countOf = new Map<number, number>();
  top.forEach((t, k) => { const tk = tokenize(t.text, lang); startOf.set(t.i, tokens.length); countOf.set(t.i, tk.length); if (k > 0 && lang !== 'zh' && tokens.length) tokens[tokens.length - 1].space = true; tokens.push(...tk); });
  // brief: the best sentence that fits, else the best
  const best = [...top].sort((x, y) => y.score - x.score);
  const briefSent = best.find((t) => t.len <= b.brief) ?? best[0];
  const start = startOf.get(briefSent.i) ?? 0; const count = countOf.get(briefSent.i) ?? 0;
  const brief: LadderItem[] = Array.from({ length: count }, (_, k) => start + k).filter((k) => k < tokens.length);
  // takeaway: what the node already has, else the brief's most telling clause: list markers and
  // bare assents ("是的", "3.", "Yes") are skipped, the clause sharing most words with the question wins
  const clauseOf = (t: string): string => {
    const parts = t.split(/[，,；;：:。.!?！？]/).map((c) => c.replace(/^\s*(\d+[.)、]?|[-*•])\s*/, '').trim()).filter(Boolean);
    const usable = parts.filter((c) => size(c, lang) >= (lang === 'zh' ? 4 : 3) && !/^(是的|好的|对的?|嗯|可以|没错|yes|ok(ay)?|sure|right|indeed)$/i.test(c));
    if (!usable.length) return parts.slice(0, 2).join(lang === 'zh' ? '，' : ', ') || t;
    const qk = new Set(words(question, lang));
    const scored = usable.map((c, i) => ({ c, s: words(c, lang).filter((w) => qk.has(w)).length + (size(c, lang) <= b.takeaway ? 0.5 : 0) - i * 0.05 }));
    return scored.sort((x, y) => y.s - x.s)[0].c;
  };
  const take = (takeaway ?? '').trim() || clauseOf(briefSent.text);
  const takeItems: LadderItem[] = tokenize(take, lang).map((t) => t.t + (t.space ? ' ' : ''));
  // topic: what the node has, else the takeaway's leading words within budget. A connective at either end is
  // not a subject (a plaque read "和" where the takeaway began "和 SolarisNet 的 LIF 相比"), and the first word
  // stays whole even when it alone runs past the budget
  let top0 = (topic ?? '').trim();
  if (!top0) {
    const tks = tokenize(take, lang);
    let from = 0; while (from < tks.length - 1 && GLUE.test(tks[from].t)) from++;
    const kept: LadderToken[] = []; let acc = '';
    for (const t of tks.slice(from)) { if (kept.length && size(acc + t.t, lang) > b.topic) break; kept.push(t); acc += t.t; }
    while (kept.length > 1 && (GLUE.test(kept[kept.length - 1].t) || /^[\p{P}\p{S}]+$/u.test(kept[kept.length - 1].t))) kept.pop();
    top0 = kept.map((t, n) => t.t + (n < kept.length - 1 && t.space && lang !== 'zh' ? ' ' : '')).join('').trim() || take;
  }
  const topicItems: LadderItem[] = tokenize(top0, lang).map((t) => t.t + (t.space ? ' ' : ''));
  if (!brief.length || !takeItems.length) return null;
  return { tokens, abstract, sentences: top.map((t) => t.i), brief, takeaway: takeItems, topic: topicItems, model: 'local' };
}
