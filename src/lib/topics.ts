// Topics: what a conversation is about, as a small table the person names
// and a judge applies to every past turn (in the host, in the background).
// Recall then reaches a turn by its topic, not only by the words it shares
// with the question; the side panel finds related conversations the same
// way. The chat model proposes topics from a spread of past questions and
// proposes search terms for a node; the judge decides which topics a text
// is about.
import { whyBridge } from './why-bridge';
import { backgroundCall } from './background-model';
import { judge, judgeAvailable, judgeCall, type JudgeQuestion } from './judge';
import { getModelsOnce } from './use-models';
import { t } from '../i18n';

/** A topic applies to a text at or above this probability. */
export const TOPIC_BAR = 0.5;
/** One click labels this many turns; the button stays until all are done. */
export const LABEL_CHUNK = 600;

const jsonArray = (raw: string): unknown[] => { const m = /\[[\s\S]*\]/.exec(raw); if (!m) return []; try { const v = JSON.parse(m[0]); return Array.isArray(v) ? v : []; } catch { return []; } };

/** Topics the chat model proposes from a spread of past questions. */
export async function proposeTopics(existing: string[]): Promise<{ name: string; description: string }[]> {
  const bridge = whyBridge();
  if (!bridge) return [];
  const sample = await bridge.sample(120);
  if (!sample.length) return [];
  const prompt = `Below are questions one person asked their coding and research assistants over time. Propose 5 to 8 topics that would sort these conversations by subject, so that later a new question can be matched to what it is about. Each topic: a short name (2 to 4 words, in the language most questions use) and one sentence saying what belongs in it and what does not. Prefer the person's own projects, methods and recurring concerns over generic labels. Do not repeat these existing topics: ${existing.join(', ') || 'none'}. Output only a JSON array of {"name": string, "description": string}.\n\n${sample.map((q, i) => `${i + 1}. ${q.replace(/\s+/g, ' ')}`).join('\n')}`;
  const { text: raw } = await backgroundCall([{ role: 'user', content: prompt }], { prefer: [(await getModelsOnce())?.default] });
  return jsonArray(raw)
    .map((x) => (x && typeof x === 'object' ? { name: String((x as { name?: unknown }).name ?? '').trim().slice(0, 60), description: String((x as { description?: unknown }).description ?? '').trim().slice(0, 240) } : null))
    .filter((x): x is { name: string; description: string } => !!x && x.name.length > 0 && !existing.some((e) => e.toLowerCase() === x.name.toLowerCase()))
    .slice(0, 8);
}

/** Which of the topics a text is about, by the judge: id → probability. Empty without a judge. */
export async function topicsOf(text: string, topics: WhyTopic[]): Promise<Record<string, number>> {
  if (!topics.length || !judgeAvailable()) return {};
  const questions: Record<string, JudgeQuestion> = Object.fromEntries(topics.map((tp) => [tp.id, { type: 'noul', instructions: `Is the text in \`text\` about the topic "${tp.name}"${tp.description ? ` (${tp.description})` : ''}?` }]));
  const r = await judge({ text: text.slice(0, 1500) }, questions);
  return Object.fromEntries(topics.map((tp) => [tp.id, r.answers[tp.id]?.noul ?? 0]));
}

/** Start (or continue) labelling in the host with the configured judge. */
export async function startLabeling(): Promise<WhyLabelStatus> {
  const bridge = whyBridge();
  const call = judgeCall();
  if (!bridge) throw new Error(t('recall.unavailable'));
  if (!call) throw new Error(t('topics.needJudge'));
  return bridge.labelStart(call, { batch: 8, max: LABEL_CHUNK });
}

/** Search terms the chat model proposes for a node, kept only when the index knows them (with how often). */
export async function expandTerms(question: string, answer: string, have: string[]): Promise<{ term: string; count: number }[]> {
  const bridge = whyBridge();
  if (!bridge) return [];
  const prompt = `From the exchange below, list up to 8 search terms someone would type to find related earlier conversations: names of projects, methods, tools, concepts, datasets, people — including closely related things the exchange implies but does not name. Single words or short names, no sentences, in the language they would have been written in. Not these, already used: ${have.join(', ') || 'none'}. Output only a JSON array of strings.\n\nQ: ${question.slice(0, 1500)}\n\nA: ${answer.slice(0, 2500)}`;
  const { text: raw } = await backgroundCall([{ role: 'user', content: prompt }], { prefer: [(await getModelsOnce())?.default] });
  const seen = new Set(have.map((h) => h.toLowerCase()));
  const terms = jsonArray(raw).map((x) => String(x ?? '').trim()).filter((x) => x.length >= 2 && x.length <= 40 && !seen.has(x.toLowerCase()) && (seen.add(x.toLowerCase()), true)).slice(0, 8);
  const counted = await Promise.all(terms.map(async (term) => ({ term, count: (await bridge.find(term, { limit: 1 }).catch(() => null))?.turns ?? 0 })));
  return counted.filter((c) => c.count > 0).sort((a, b) => b.count - a.count);
}
