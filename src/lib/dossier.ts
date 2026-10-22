// A dossier: what is known about one topic, as a maintained document the
// model can read in a few hundred tokens and the person can check. Four
// sections — what it is, the decisions taken, where it stands now, what is
// still open — every sentence citing the turns it rests on, a changelog,
// and the set of turns already read so an update only reads what is new.
// The chat model writes it (here, in the canvas, where the model keys
// live); the why layer keeps it, so the desktop and the plugin share one.
import { whyBridge } from './why-bridge';
import { backgroundCall } from './background-model';
import { getModelsOnce } from './use-models';
import { useI18n } from '../i18n';
import { countTokens } from '../utils';
import { t, fmt } from '../i18n';

export type DossierSection = 'what' | 'decisions' | 'now' | 'open';
export const SECTION_ORDER: DossierSection[] = ['what', 'decisions', 'now', 'open'];
export const SECTION_KEY: Record<DossierSection, 'dossier.secWhat' | 'dossier.secDecisions' | 'dossier.secNow' | 'dossier.secOpen'> = { what: 'dossier.secWhat', decisions: 'dossier.secDecisions', now: 'dossier.secNow', open: 'dossier.secOpen' };
/** How many turns a first build reads (newest first) and an update reads. */
export const BUILD_TURNS = 100;
export const UPDATE_TURNS = 60;
/** An update runs by itself once this many facts wait in a dossier's inbox. */
export const AUTO_MERGE_PENDING = 6;
const CONTEXT_CAP_CHARS = 3200;

const when = (at: string | null | undefined): string => (at ? at.slice(5, 10).replace('-', '-') : '');
const sourceTag = (d: WhyDossier, key: string): string => { const s = d.sources[key]; return s ? `${s.runner} ${when(s.at)}` : ''; };

/** The document as markdown: for the context block and the panel. */
export function renderDossier(d: WhyDossier, name: string, opts: { cap?: number; sources?: boolean } = {}): string {
  const cap = opts.cap ?? CONTEXT_CAP_CHARS;
  const withSrc = opts.sources ?? true;
  const parts: string[] = [`## ${fmt(t('dossier.title'), { name })}${d.updatedAt ? ` (${t('dossier.updated')} ${d.updatedAt.slice(0, 10)})` : ''}`];
  for (const sec of SECTION_ORDER) {
    const lines = d.sections[sec];
    if (!lines.length) continue;
    parts.push(`### ${t(SECTION_KEY[sec])}`);
    for (const s of lines) {
      const tags = withSrc ? s.src.map((k) => sourceTag(d, k)).filter(Boolean).slice(0, 2) : [];
      parts.push(`- ${s.text}${tags.length ? ` (${tags.join('; ')})` : ''}`);
    }
  }
  const md = parts.join('\n');
  return md.length > cap ? md.slice(0, cap).trimEnd() + '\n…' : md;
}
export const dossierTokens = (d: WhyDossier, name: string): number => countTokens(renderDossier(d, name));
export const dossierEmpty = (d: WhyDossier | null | undefined): boolean => !d || SECTION_ORDER.every((s) => d.sections[s].length === 0);

type Excerpt = { key: string; q: string; a: string };
type Sections = WhyDossier['sections'];
const emptySections = (): Sections => ({ what: [], decisions: [], now: [], open: [] });

/** The model writes or revises the four sections from excerpts (each with
 *  its key) and filed facts; sentences cite keys. One JSON object out. */
async function synthesize(name: string, description: string, current: WhyDossier | null, excerpts: Excerpt[], pending: { text: string; at: string }[]): Promise<{ sections: Sections; change: string }> {
  const lang = useI18n.getState().lang === 'zh' ? 'Chinese' : 'the language the excerpts are mostly written in';
  const cur = current && !dossierEmpty(current) ? JSON.stringify(current.sections) : null;
  const ex = excerpts.map((e) => `[${e.key}] Q: ${e.q.slice(0, 220)}\nA: ${e.a.slice(0, 420)}`).join('\n\n');
  const facts = pending.length ? `\n\nFacts filed for this topic since (from later sessions, not from the excerpts; cite them as "filed:<n>"):\n${pending.map((p, i) => `filed:${i + 1} (${p.at.slice(0, 10)}): ${p.text}`).join('\n')}` : '';
  const prompt = `You maintain a dossier about the topic "${name}"${description ? ` (${description})` : ''} for one person, written from their past conversations with assistants. It has four sections: "what" (what the topic is: 2–4 sentences), "decisions" (choices that were made; newest last; when a later excerpt reverses an earlier decision, keep one line that says what replaced what), "now" (where things stand at the latest date; the newest excerpt wins), "open" (questions still unresolved).${cur ? `\n\nThe current dossier, as JSON (sentences carry the keys of the excerpts they rest on):\n${cur}\n\nBelow are ONLY the excerpts it has not read yet, newest first.` : '\n\nBelow are the excerpts, newest first.'}\n\n${ex || '(no new excerpts)'}${facts}\n\nRevise (or write) the dossier. Every sentence must be short, concrete (names, numbers, files, dates as they appear), in ${lang}, and cite the excerpt keys it rests on in "src" (keep existing sentences' keys when they still hold; drop a sentence only when the new excerpts contradict or supersede it). Do not invent anything not in the excerpts or facts. Output ONE JSON object and nothing else: {"what":[{"text":"…","src":["key"]}],"decisions":[…],"now":[…],"open":[…],"change":"one short sentence in ${lang} saying what this revision changed"}`;
  const bg = (await getModelsOnce())?.default ?? undefined;
  const { text: raw } = await backgroundCall([{ role: 'user', content: prompt }], { prefer: [bg] });
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) throw new Error(t('dossier.badOutput'));
  const j = JSON.parse(m[0]) as Partial<Record<DossierSection, { text?: unknown; src?: unknown }[]>> & { change?: unknown };
  const valid = new Set([...excerpts.map((e) => e.key), ...Object.keys(current?.sources ?? {}), ...pending.map((_, i) => `filed:${i + 1}`)]);
  const sections = emptySections();
  for (const sec of SECTION_ORDER) {
    sections[sec] = (Array.isArray(j[sec]) ? j[sec]! : []).map((s) => ({ text: String(s?.text ?? '').trim().slice(0, 400), src: (Array.isArray(s?.src) ? s.src : []).map(String).filter((k) => valid.has(k)).slice(0, 4) })).filter((s) => s.text.length > 0).slice(0, sec === 'what' ? 6 : 12);
  }
  if (SECTION_ORDER.every((s) => sections[s].length === 0)) throw new Error(t('dossier.badOutput'));
  return { sections, change: String(j.change ?? '').trim().slice(0, 160) };
}

const sourcesOf = (hits: (WhyFindHit & { topics?: Record<string, number> })[]): Record<string, WhyDossierSource> =>
  Object.fromEntries(hits.map((h) => [`${h.session}#${h.turn}`, { session: h.session, turn: h.turn, runner: h.runner, title: h.title, at: h.at, open: h.open, kind: h.kind }]));

async function topicOf(topicId: string): Promise<{ name: string; description: string }> {
  const tt = await whyBridge()!.topics();
  const tp = tt.topics.find((x) => x.id === topicId);
  if (!tp) throw new Error(t('dossier.noTopic'));
  return { name: tp.name, description: tp.description };
}

/** Write the document from the topic's newest turns. */
export async function buildDossier(topicId: string): Promise<WhyDossier> {
  const bridge = whyBridge();
  if (!bridge) throw new Error(t('recall.unavailable'));
  const tp = await topicOf(topicId);
  const fresh = await bridge.dossierNewTurns(topicId, { limit: BUILD_TURNS });
  const current = await bridge.dossier(topicId);
  if (!fresh.excerpts.length && !(current?.pending.length)) throw new Error(t('dossier.nothingToRead'));
  const read = current?.pending ?? [];
  const { sections, change } = await synthesize(tp.name, tp.description, null, fresh.excerpts, read);
  const now = new Date().toISOString();
  // the inbox is not cleared: the facts the model read leave by id, and one
  // filed while it was writing waits for the next update (#48)
  return bridge.setDossier(topicId, {
    sections, sources: sourcesOf(fresh.hits), covered: fresh.excerpts.map((e) => e.key), consumePending: read.map((p) => p.id),
    changelog: [{ at: now, note: fmt(t('dossier.logBuilt'), { n: fresh.excerpts.length }) + (change ? ` · ${change}` : '') }], builtAt: now,
  });
}

/** Read what is new (turns and filed facts) into the existing document. */
export async function updateDossier(topicId: string): Promise<WhyDossier> {
  const bridge = whyBridge();
  if (!bridge) throw new Error(t('recall.unavailable'));
  const current = await bridge.dossier(topicId);
  if (!current?.builtAt) return buildDossier(topicId);
  const tp = await topicOf(topicId);
  const fresh = await bridge.dossierNewTurns(topicId, { limit: UPDATE_TURNS });
  if (!fresh.excerpts.length && !current.pending.length) return current;
  const read = current.pending;
  const { sections, change } = await synthesize(tp.name, tp.description, current, fresh.excerpts, read);
  const now = new Date().toISOString();
  return bridge.setDossier(topicId, {
    sections, sources: { ...current.sources, ...sourcesOf(fresh.hits) }, covered: [...current.covered, ...fresh.excerpts.map((e) => e.key)], consumePending: read.map((p) => p.id),
    changelog: [...current.changelog, { at: now, note: change || fmt(t('dossier.logUpdated'), { n: fresh.excerpts.length, m: current.pending.length }) }].slice(-40),
  });
}

/** Throw the document away and write it again from the turns. */
export async function rebuildDossier(topicId: string): Promise<WhyDossier> {
  const bridge = whyBridge();
  if (!bridge) throw new Error(t('recall.unavailable'));
  const current = await bridge.dossier(topicId);
  // the inbox is left as it is: whatever was filed stays for the build to read
  await bridge.setDossier(topicId, { sections: emptySections(), sources: {}, covered: [], changelog: current?.changelog ?? [], builtAt: null });
  return buildDossier(topicId);
}

/** A hand edit of one section: lines in, sentences out (sources kept where the text is unchanged). */
export async function editDossierSection(topicId: string, sec: DossierSection, lines: string[]): Promise<WhyDossier> {
  const bridge = whyBridge();
  const current = await bridge!.dossier(topicId);
  if (!current) throw new Error(t('dossier.noTopic'));
  const prev = current.sections[sec];
  const next = lines.map((l) => l.trim()).filter(Boolean).map((text) => ({ text, src: prev.find((p) => p.text === text)?.src ?? [] }));
  const now = new Date().toISOString();
  return bridge!.setDossier(topicId, { sections: { ...current.sections, [sec]: next }, changelog: [...current.changelog, { at: now, note: fmt(t('dossier.logEdited'), { s: t(SECTION_KEY[sec]) }) }].slice(-40) });
}

/** The dossiers of the given topics that exist, rendered for a context. */
export async function dossiersFor(topicIds: string[]): Promise<{ topicId: string; name: string; updatedAt: string; md: string; tokens: number }[]> {
  const bridge = whyBridge();
  if (!bridge || !topicIds.length) return [];
  const summaries = await bridge.dossiers().catch(() => []);
  const out: { topicId: string; name: string; updatedAt: string; md: string; tokens: number }[] = [];
  for (const id of topicIds) {
    const s = summaries.find((x) => x.topicId === id);
    if (!s?.built) continue;
    const d = await bridge.dossier(id).catch(() => null);
    if (!d || dossierEmpty(d)) continue;
    const md = renderDossier(d, s.name);
    out.push({ topicId: id, name: s.name, updatedAt: d.updatedAt, md, tokens: countTokens(md) });
  }
  return out;
}
