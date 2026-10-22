// The person's own memory as two documents, not a list of fragments: what
// they prefer (how they like things done) and who they are (role, field,
// long-term agenda). A new fact is merged into the document by rewriting
// the line it refines or contradicts (newest wins), never appended blindly;
// every rewrite leaves one line in the document's changelog. Project
// facts do not live here — they are filed into the topic's dossier (or the
// inbox when no topic fits). The legacy fragment list migrates on first use.
import { backgroundCall } from './background-model';
import { getModelsOnce } from './use-models';
import { useUiStore } from './ui-store';
import { generateId } from '../utils';
import type { MemoryEntry } from './memory';

/** Where a line came from: the fact that wrote it, when, from which canvas,
 *  and on what evidence (the constitution's stated/inferred distinction,
 *  decided at admission and carried through every rewrite since it cannot
 *  be re-decided from the rewritten words; #51). A hand edit is its own
 *  evidence; lines folded from the pre-0.5 fragment list say so. */
export interface LineNote { text: string; at: string; from?: string; evidence: 'stated' | 'inferred' | 'manual' | 'folded'; /** the line this one replaced, when the rewrite touched exactly one */ was?: string }
export interface MemoryDoc { text: string; updatedAt: string | null; changelog: { at: string; note: string }[]; /** provenance per line, by the line's text; lines written before 0.5.9 have none */ notes?: LineNote[] }
export interface Profile { preferences: MemoryDoc; identity: MemoryDoc }
export type ProfileKind = keyof Profile;
export interface InboxItem { id: string; text: string; at: string; from?: string }
/** What a merged fact rests on, as the admission decided it. */
export interface FactOrigin { evidence: 'stated' | 'inferred'; from?: string }

export const emptyDoc = (): MemoryDoc => ({ text: '', updatedAt: null, changelog: [] });
export const emptyProfile = (): Profile => ({ preferences: emptyDoc(), identity: emptyDoc() });
const CHANGELOG_CAP = 40;
/** The constitution's code-level backstop: nothing credential-like is ever written, by the judge or by a rewrite. */
export const CREDENTIAL_PATTERN = /sk-[a-zA-Z0-9_-]{8,}|api[ _-]?key|password|token|secret/i;
/** A rewrite for ONE fact may refine one line, or fold two duplicates; dropping more is a rewrite of the document, which the fact did not license. */
const REWRITE_MAX_GONE = 2;

/** The document's facts, one per line, without bullets. */
export const docLines = (d: MemoryDoc | undefined): string[] => (d?.text ?? '').split('\n').map((l) => l.replace(/^[-•*\s]+/, '').trim()).filter((l) => l.length > 0);
export const profileLines = (p: Profile): string[] => [...docLines(p.identity), ...docLines(p.preferences)];
const asDoc = (lines: string[]): string => lines.map((l) => `- ${l}`).join('\n');
export const lineNote = (d: MemoryDoc | undefined, line: string): LineNote | undefined => d?.notes?.find((n) => n.text === line);

/** The notes after the lines changed: a line that stayed keeps its note; a
 *  line that is new is credited to `origin`, naming the one line it replaced
 *  when exactly one went away for exactly one that came. */
function carryNotes(before: MemoryDoc, lines: string[], origin: Omit<LineNote, 'text' | 'at'>, now: string): LineNote[] {
  const old = docLines(before);
  const gone = old.filter((l) => !lines.includes(l));
  const fresh = lines.filter((l) => !old.includes(l));
  const out: LineNote[] = [];
  for (const l of lines) {
    const kept = lineNote(before, l);
    if (kept) out.push(kept);
    else if (!old.includes(l)) out.push({ text: l, at: now, ...origin, ...(gone.length === 1 && fresh.length === 1 ? { was: gone[0] } : {}) });
  }
  return out;
}

/** The fragment list of earlier versions folds into the documents once:
 *  preferences and identity by category, everything else into the inbox. */
export function migrateLegacyMemories(): void {
  const st = useUiStore.getState();
  const legacy: MemoryEntry[] = st.memories;
  if (!legacy.length) return;
  const now = new Date().toISOString();
  const pref = legacy.filter((m) => m.category === 'preference').map((m) => m.text.trim()).filter(Boolean);
  const idn = legacy.filter((m) => m.category === 'identity').map((m) => m.text.trim()).filter(Boolean);
  const rest = legacy.filter((m) => m.category !== 'preference' && m.category !== 'identity');
  const p = st.profile;
  const fold = (doc: MemoryDoc, entries: MemoryEntry[]): MemoryDoc => {
    const have = docLines(doc);
    const added = entries.map((m) => m.text.trim()).filter((x) => x && !have.includes(x));
    const lines = [...have, ...added];
    const notes = [...(doc.notes ?? []), ...entries.filter((m) => added.includes(m.text.trim())).map((m): LineNote => ({ text: m.text.trim(), at: m.at, ...(m.project ? { from: m.project } : {}), evidence: 'folded' }))];
    return { text: asDoc(lines), updatedAt: now, changelog: [...doc.changelog, { at: now, note: `folded ${entries.length} earlier entries` }].slice(-CHANGELOG_CAP), notes };
  };
  const merged: Profile = {
    preferences: pref.length ? fold(p.preferences, legacy.filter((m) => m.category === 'preference' && m.text.trim())) : p.preferences,
    identity: idn.length ? fold(p.identity, legacy.filter((m) => m.category === 'identity' && m.text.trim())) : p.identity,
  };
  st.setProfile(merged);
  if (rest.length) st.setMemoryInbox([...st.memoryInbox, ...rest.map((m) => ({ id: m.id, text: m.text, at: m.at, ...(m.project ? { from: m.project } : {}) }))]);
  try { localStorage.setItem('thoughtdag.memory.legacy', JSON.stringify(legacy)); } catch { /* the fold is the record */ }
  st.setMemories([]);
}

/** Merge one observed fact into a document: the model rewrites the lines
 *  (refine or replace the line it touches, else add one) and names the
 *  change. The rewrite is then held to the constitution mechanically: no
 *  credential-like line comes in, and one fact may not take more than two
 *  lines away (then the fact is appended instead). Every line keeps or gets
 *  its provenance. Returns what it was and what it is, so a toast can undo. */
export async function mergeIntoDoc(kind: ProfileKind, fact: string, origin: FactOrigin = { evidence: 'inferred' }): Promise<{ before: MemoryDoc; after: MemoryDoc }> {
  const before = useUiStore.getState().profile[kind];
  const lines = docLines(before);
  const now = new Date().toISOString();
  let after: MemoryDoc;
  if (!lines.length) {
    after = { text: asDoc([fact]), updatedAt: now, changelog: [{ at: now, note: fact.slice(0, 80) }], notes: carryNotes(before, [fact], origin, now) };
  } else {
    const what = kind === 'preferences' ? 'how the user likes things done (language, style, format, tools, models)' : 'who the user is (role, field, expertise, long-term agenda)';
    const prompt = `A document of durable notes about one user — ${what} — one fact per line:\n\n${asDoc(lines)}\n\nA new fact was observed: "${fact}"\n\nRewrite the document so it includes the new fact: when it refines or contradicts an existing line, rewrite that line (the newest observation wins); otherwise add one line. Keep every line short and in the language the lines are written in; no duplicates, no headings, no commentary. Output the document lines only, each starting with "- ", then one last line "CHANGE: <one short sentence saying what changed>".`;
    const bg = (await getModelsOnce())?.default ?? undefined;
    const { text: raw } = await backgroundCall([{ role: 'user', content: prompt }], { prefer: [bg] });
    const out = raw.split('\n').map((l) => l.trim());
    let newLines = out.filter((l) => /^[-•*]\s+/.test(l)).map((l) => l.replace(/^[-•*]\s+/, '').trim()).filter(Boolean);
    let change = out.find((l) => /^CHANGE:/i.test(l))?.replace(/^CHANGE:\s*/i, '').trim() || fact.slice(0, 80);
    if (newLines.length < Math.max(1, Math.floor(lines.length / 2))) throw new Error('the rewrite dropped most of the document');
    // the constitution, re-run on what the model wrote: a line that stayed was admitted once already
    newLines = newLines.filter((l) => lines.includes(l) || !CREDENTIAL_PATTERN.test(l));
    const gone = lines.filter((l) => !newLines.includes(l));
    if (gone.length > REWRITE_MAX_GONE) {
      newLines = [...lines, fact];
      change = `${fact.slice(0, 80)} (added as a line: the rewrite would have dropped ${gone.length} lines)`;
    }
    after = { text: asDoc(newLines), updatedAt: now, changelog: [...before.changelog, { at: now, note: change }].slice(-CHANGELOG_CAP), notes: carryNotes(before, newLines, origin, now) };
  }
  const st = useUiStore.getState();
  st.setProfile({ ...st.profile, [kind]: after });
  return { before, after };
}

/** A hand edit: the text as typed, one changelog line; the lines that changed are the person's own evidence. */
export function setDocText(kind: ProfileKind, text: string, note: string): void {
  const st = useUiStore.getState();
  const now = new Date().toISOString();
  const cur = st.profile[kind];
  const lines = text.split('\n').map((l) => l.replace(/^[-•*\s]+/, '').trim()).filter(Boolean);
  st.setProfile({ ...st.profile, [kind]: { text: asDoc(lines), updatedAt: now, changelog: [...cur.changelog, { at: now, note }].slice(-CHANGELOG_CAP), notes: carryNotes(cur, lines, { evidence: 'manual' }, now) } });
}

export function restoreDoc(kind: ProfileKind, doc: MemoryDoc): void {
  const st = useUiStore.getState();
  st.setProfile({ ...st.profile, [kind]: doc });
}

// ── the inbox: project facts no topic claimed ──
export function addInbox(text: string, from?: string): InboxItem {
  const item: InboxItem = { id: generateId(), text: text.trim(), at: new Date().toISOString(), ...(from ? { from } : {}) };
  const st = useUiStore.getState();
  st.setMemoryInbox([...st.memoryInbox, item]);
  return item;
}
export function removeInbox(id: string): void {
  const st = useUiStore.getState();
  st.setMemoryInbox(st.memoryInbox.filter((i) => i.id !== id));
}
