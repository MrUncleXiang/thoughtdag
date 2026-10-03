// Ask the canvas: a reading aid, not a second canvas. The model reads an
// outline of the whole graph (every live node under a short number, its
// topic and takeaway, its parents), the selected node's own chain in full,
// and answers with [[numbers]] that the dialog turns into chips that locate
// the node. What was sent is kept per turn, in the layers the Context Bundle
// names, and an answer enters the graph only when the person drops it there.
// After the trajectory visualizer's dialog (Visualizer/trajactory_visualizer),
// whose outline + citation + red-unknown grammar this keeps.
import type { ThoughtNode, ThoughtEdge, ThoughtData } from '../types';
import { partitionContext } from './graph';
import { levelText, sentencesOf } from './ladder-core';
import { llmCall, type ContextMessage } from './api';
import { activeSummary, activeTopic } from '../utils';

export type ChatLayer = 'outline' | 'chain' | 'material' | 'reference';
export interface ChatContextItem { layer: ChatLayer; node: string; chars: number }
export interface CanvasChatTurn {
  id: string; role: 'user' | 'assistant'; text: string; at: string;
  /** the node the question was asked about, when one was selected */
  focus?: string | null;
  model?: string;
  context?: ChatContextItem[];
  /** node ids the answer cited (unknown numbers excluded) */
  cites?: string[];
  /** the numbers the answer used, as the request mapped them: a number only means something within its request,
   *  so the text is rendered with this map ever after, and chips and wires can never disagree (#60) */
  aliases?: Record<string, string>;
  /** the canvas the question was asked on: an answer lands only there (#59) */
  project?: string;
  error?: string;
}
/** a parsed answer: text runs and node citations, unknown numbers kept apart so the reader sees them */
export type CitePart = { kind: 'text'; text: string } | { kind: 'node'; alias: string; id: string } | { kind: 'unknown'; alias: string };

const one = (s: string) => s.replace(/\s+/g, ' ').trim();
const clip = (s: string, max: number): string => {
  const t = s.trim();
  if (t.length <= max) return t;
  const head = Math.round(max * 0.72);
  return `${t.slice(0, head)}\n…\n${t.slice(t.length - (max - head))}`;
};

/** Short numbers for one request: n1… in canvas order; archived nodes are out of the record. */
export function aliasNodes(nodes: ThoughtNode[]): { live: ThoughtNode[]; byId: Map<string, string>; byAlias: Map<string, string> } {
  const live = nodes.filter((n) => !n.data.archived && n.data.stepKind !== 'frame');
  const byId = new Map<string, string>(); const byAlias = new Map<string, string>();
  live.forEach((n, i) => { const a = `n${i + 1}`; byId.set(n.id, a); byAlias.set(a, n.id); });
  return { live, byId, byAlias };
}

/** A node's one-line label: its ladder's topic and takeaway, else the question and the answer's first sentence. */
export function nodeLabel(d: ThoughtData, lang: 'zh' | 'en'): string {
  if (d.stepKind === 'note') return `${lang === 'zh' ? '便签' : 'note'}：${one(clip(d.question ?? '', 120))}`;
  if (d.stepKind === 'file' || d.stepKind === 'link') {
    const names = (d.attachments ?? []).filter((a) => !a.name.startsWith('tool: ')).map((a) => a.name).join(', ');
    return `${lang === 'zh' ? '材料' : 'material'}：${one(names || d.linkUrl || d.question || '')}`;
  }
  const ladder = d.summaryLadders?.[d.responseIndex ?? 0] ?? undefined;
  if (ladder) {
    const topic = one(levelText(ladder, 0)); const takeaway = one(levelText(ladder, 1));
    if (topic && takeaway && takeaway !== topic) return `${topic}：${takeaway}`;
    if (topic || takeaway) return topic || takeaway;
  }
  const topic = activeTopic(d) || one(clip(d.question ?? '', 60));
  const summary = activeSummary(d) || sentencesOf(d.response ?? '')[0] || '';
  return summary ? `${topic}：${one(clip(summary, 140))}` : topic;
}

/** The whole canvas in a few thousand characters: one line a node, its number, its label, its parents by number. */
export function outline(nodes: ThoughtNode[], edges: ThoughtEdge[], lang: 'zh' | 'en', byId: Map<string, string>): string {
  const live = nodes.filter((n) => byId.has(n.id));
  const parents = new Map<string, { alias: string; ref: boolean }[]>();
  for (const e of edges) {
    const s = byId.get(e.source), t = byId.get(e.target);
    if (!s || !t) continue;
    if (!parents.has(e.target)) parents.set(e.target, []);
    parents.get(e.target)!.push({ alias: s, ref: !!e.data?.isCrossLink });
  }
  const lines: string[] = [];
  for (const n of live) {
    const ps = parents.get(n.id) ?? [];
    const from = ps.length ? `（${lang === 'zh' ? '上游' : 'from'} ${ps.map((p) => (p.ref ? `${p.alias}${lang === 'zh' ? '·引用' : '·ref'}` : p.alias)).join(', ')}）` : '';
    lines.push(`[[${byId.get(n.id)}]]${from} ${nodeLabel(n.data, lang)}`);
  }
  return lines.join('\n');
}

const SYSTEM_ZH = `你在帮作者读懂一张 ThoughtDAG 画布。画布是一张有向图：节点是一轮问答、一张便签或一份材料，连线是上下文的流向（上游的内容进入下游的提问）。只根据下面给出的内容回答：画布大纲、当前关注的节点和它的脉络、相关材料。
规则：
1. 提到某个节点时用 [[编号]] 标出，例如 [[n12]]；读者点击编号就会在画布上定位到它。每个判断至少落到一个编号。
2. 大纲里没有的事不要编；需要推断时写明「推断：」。
3. 先结论，再依据；用作者的语言，简短。`;
const SYSTEM_EN = `You help the author read a ThoughtDAG canvas: a directed graph whose nodes are a question and its answer, a note, or a material, and whose wires carry context downstream (what sits upstream enters the asks below it). Answer only from what follows: the canvas outline, the focused node and its chain, related materials.
Rules:
1. Cite a node as [[number]], for example [[n12]]; the reader clicks the number to locate the node on the canvas. Every claim rests on at least one number.
2. Invent nothing the outline lacks; mark inferences as "Inference:".
3. Conclusion first, then the grounds; in the author's language, briefly.`;

/** System text and messages for the model, and the record of what was sent. */
export function buildCanvasChat(nodes: ThoughtNode[], edges: ThoughtEdge[], focusId: string | null, question: string, history: CanvasChatTurn[], lang: 'zh' | 'en', budget = 40000): { messages: ContextMessage[]; context: ChatContextItem[]; byAlias: Map<string, string>; byId: Map<string, string> } {
  const { byId, byAlias } = aliasNodes(nodes);
  const context: ChatContextItem[] = [];
  const parts: string[] = [];
  const out = outline(nodes, edges, lang, byId);
  parts.push(`${lang === 'zh' ? '【画布大纲】' : '[Canvas outline]'}\n${out}`);
  for (const id of byId.keys()) context.push({ layer: 'outline', node: id, chars: 0 });
  let used = out.length;
  const focus = focusId && byId.has(focusId) ? nodes.find((n) => n.id === focusId) : undefined;
  if (focus) {
    const p = partitionContext(focus.id, nodes, edges);
    const label = (n: ThoughtNode) => `[[${byId.get(n.id)}]] ${nodeLabel(n.data, lang)}`;
    const own = `${lang === 'zh' ? '【当前关注】' : '[Focused node]'}${label(focus)}\nQ: ${clip(focus.data.question ?? '', 1200)}\nA: ${clip(focus.data.response ?? '', 2400)}`;
    parts.push(own); used += own.length; context.push({ layer: 'chain', node: focus.id, chars: own.length });
    const chain = p.mainline.filter((n) => n.id !== focus.id && byId.has(n.id));
    if (chain.length) {
      const block = chain.map((n) => { const s = `${label(n)}\nQ: ${clip(n.data.question ?? '', 300)}\nA: ${clip(n.data.response ?? '', 700)}`; context.push({ layer: 'chain', node: n.id, chars: s.length }); return s; }).join('\n');
      if (used + block.length <= budget) { parts.push(`${lang === 'zh' ? '【它所在的脉络，上游在前】' : '[Its chain, upstream first]'}\n${block}`); used += block.length; }
    }
    const mats = p.materials.filter((n) => byId.has(n.id));
    if (mats.length) {
      const block = mats.map((n) => { const text = (n.data.attachments ?? []).map((a) => a.extractedText ?? '').join('\n') || n.data.question || ''; const s = `${label(n)}\n${clip(text, 900)}`; context.push({ layer: 'material', node: n.id, chars: s.length }); return s; }).join('\n');
      if (used + block.length <= budget) { parts.push(`${lang === 'zh' ? '【材料】' : '[Materials]'}\n${block}`); used += block.length; }
    }
    const refs = p.references.map((r) => r.source).filter((n) => byId.has(n.id) && n.id !== focus.id);
    if (refs.length) {
      const block = refs.map((n) => { const s = `${label(n)}\nQ: ${clip(n.data.question ?? '', 300)}\nA: ${clip(n.data.response ?? '', 700)}`; context.push({ layer: 'reference', node: n.id, chars: s.length }); return s; }).join('\n');
      if (used + block.length <= budget) { parts.push(`${lang === 'zh' ? '【引用进来的节点】' : '[Referenced nodes]'}\n${block}`); used += block.length; }
    }
  }
  const messages: ContextMessage[] = [{ role: 'system', content: `${lang === 'zh' ? SYSTEM_ZH : SYSTEM_EN}\n\n${parts.join('\n\n')}` }];
  for (const t of history.filter((h) => !h.error).slice(-8)) messages.push({ role: t.role, content: t.text });
  messages.push({ role: 'user', content: question });
  return { messages, context, byAlias, byId };
}

/** The answer's [[numbers]] resolved against the request's map; numbers the canvas does not have are kept as unknown. */
export function citations(text: string, byAlias: Map<string, string>): CitePart[] {
  const parts: CitePart[] = [];
  const re = /\[\[\s*(n\d+)\s*\]\]|\[\[\s*([^\]\n]{1,40})\s*\]\]/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ kind: 'text', text: text.slice(last, m.index) });
    const alias = (m[1] ?? m[2]).trim();
    const id = byAlias.get(alias);
    parts.push(id ? { kind: 'node', alias, id } : { kind: 'unknown', alias });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

/** Ask once: the model reads the canvas and answers with citations. The returned turn carries what was sent. */
export async function askCanvas(nodes: ThoughtNode[], edges: ThoughtEdge[], focusId: string | null, question: string, history: CanvasChatTurn[], lang: 'zh' | 'en', model?: string): Promise<{ turn: CanvasChatTurn; byAlias: Map<string, string> }> {
  const { messages, context, byAlias } = buildCanvasChat(nodes, edges, focusId, question, history, lang);
  const at = new Date().toISOString();
  try {
    const text = await llmCall(messages, undefined, model);
    const parts = citations(text, byAlias);
    const cites = [...new Set(parts.flatMap((p) => (p.kind === 'node' ? [p.id] : [])))];
    const aliases: Record<string, string> = {};
    for (const p of parts) if (p.kind === 'node') aliases[p.alias] = p.id;
    return { turn: { id: `${Date.now()}-a`, role: 'assistant', text, at, focus: focusId, model, context, cites, aliases }, byAlias };
  } catch (e) {
    return { turn: { id: `${Date.now()}-a`, role: 'assistant', text: '', at, focus: focusId, model, context, error: e instanceof Error ? e.message : String(e) }, byAlias };
  }
}

/** The answer as markdown with its citations as explore marks (the sanitizer lets these through): the dialog
 *  renders it with the numbers as chips, a dropped node with the nodes' titles, since a number only means
 *  something within its request. A number the canvas lacks is a mark with no target, styled as a doubt. */
export function answerForCanvas(text: string, byAlias: Map<string, string>, nodes: ThoughtNode[], lang: 'zh' | 'en', label: 'alias' | 'title' = 'title'): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return citations(text, byAlias).map((p) => {
    if (p.kind === 'text') return p.text;
    if (p.kind === 'unknown') return `<mark class="explore-mark" data-explore-target="" title="?">${esc(p.alias)}?</mark>`;
    const n = nodes.find((x) => x.id === p.id);
    const full = n ? nodeLabel(n.data, lang) : p.alias;
    const shown = label === 'alias' ? p.alias : one(clip(full.split('：')[0], 40));
    return `<mark class="explore-mark" data-explore-target="${esc(p.id)}" title="${esc(label === 'alias' ? full : p.alias)}">${esc(shown)}</mark>`;
  }).join('');
}
