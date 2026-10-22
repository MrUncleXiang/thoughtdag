import type { StateCreator } from 'zustand';
import { HISTORY_LIMIT } from '../../lib/constants';
import type { StoreState, HistorySlice, Snapshot } from '../types';
import type { Attachment, ThoughtData, ThoughtEdge, ThoughtNode } from '../../types';
import { condenseGuard } from '../../lib/condense-guard';
import { toast } from '../../lib/ui-store';
import { t } from '../../i18n';

// Undo snapshots are SHALLOW references, not deep copies. Every store
// update is immutable (map + spread; React Flow's applyNodeChanges too),
// so a snapshot's arrays and objects are never mutated after the fact —
// structural sharing makes snapshots O(1) instead of a full serialize of
// every attachment. With PDF-heavy canvases (base64 content + page
// images on nodes) the deep copy was 100-400ms per interaction and up
// to 50× the store size in memory; shallow is microseconds and ~1×.
// INVARIANT this relies on: never mutate a node/edge object that has
// entered the store — always map to fresh objects.
//
// What a step is. Undo then redo returns the canvas to exactly where it
// was, and each undo takes back one thing the person did. So the history
// compares what the person made (text, wiring, arrangement) and nothing
// else: the snapshot at the cursor is checked against the live canvas
// before every move, and a change no call site recorded (a drag, a note
// committed after its snapshot) becomes its own step instead of riding
// along with the one before it. What the app writes while it works is not
// a step: transient fields always come from the live canvas, derived ones
// follow the content they were written from.

/** Set while the app works, never by the person: a snapshot never brings them back. */
const TRANSIENT: (keyof ThoughtData)[] = ['isLoading', 'isEditing', 'isEditingResponse', 'restreaming', 'pendingApprovals', 'agentTrace', 'reasoning', 'recallProgress'];
/** Choices for the next ask (its model, search, recall): settings, not steps; they stay as the person last set them. */
const SETTINGS: (keyof ThoughtData)[] = ['model', 'webSearch', 'scholarSearch', 'recall', 'recallReach', 'recallScale'];
/** Written from a node's content (plaques, ladders, counts): they follow that content. */
const DERIVED: (keyof ThoughtData)[] = ['summary', 'summaries', 'summaryTypes', 'summaryTypeConfidences', 'summaryConclusiveness', 'summaryTopics', 'summaryLadders', 'tokenCount'];
/** What identifies an answer version while it is still streaming. */
const VERSION: (keyof ThoughtData)[] = ['question', 'questions', 'responses', 'responseIndex', 'stepKind'];
/** Attachment fields the app fills in (extraction, digests, the vault); extracted text is the person's once edited by hand. */
const ATT_MACHINE = new Set<string>(['isExtracting', 'extractedText', 'extractedBy', 'digest', 'digestBy', 'pageImages', 'figures', 'numPages', 'thumbnailUrl', 'content', 'contentInVault']);
const NODE_VIEW = new Set<string>(['selected', 'dragging', 'measured', 'resizing', 'data']);
const SKIP_DATA = new Set<string>([...TRANSIENT, ...SETTINGS, ...DERIVED, 'attachments'] as string[]);

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => same(v, bb[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) if (!same(ao[k], bo[k])) return false;
  return true;
}

function sameById<T extends { id: string }>(a: T[], b: T[], eq: (x: T, y: T) => boolean): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  if (a.every((x, i) => x === b[i])) return true;
  const byId = new Map(b.map((y) => [y.id, y]));
  return a.every((x) => {
    const y = byId.get(x.id);
    return !!y && (x === y || eq(x, y));
  });
}

function sameAttachment(a: Attachment, b: Attachment): boolean {
  const manual = a.extractedBy === 'manual' || b.extractedBy === 'manual';
  if (manual && (a.extractedText !== b.extractedText || a.extractedBy !== b.extractedBy)) return false;
  const ao = a as unknown as Record<string, unknown>;
  const bo = b as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
    if (!ATT_MACHINE.has(k) && !same(ao[k], bo[k])) return false;
  }
  return true;
}

/** The person's content of a node, ignoring what the app writes around it. */
function sameContent(a: ThoughtData, b: ThoughtData): boolean {
  if (a === b) return true;
  const ao = a as unknown as Record<string, unknown>;
  const bo = b as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
    if (!SKIP_DATA.has(k) && !same(ao[k], bo[k])) return false;
  }
  return sameById(a.attachments ?? [], b.attachments ?? [], sameAttachment);
}

const sameVersion = (a: ThoughtData, b: ThoughtData) => VERSION.every((k) => same(a[k], b[k]));

function sameNode(a: ThoughtNode, b: ThoughtNode): boolean {
  const ao = a as unknown as Record<string, unknown>;
  const bo = b as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
    if (!NODE_VIEW.has(k) && !same(ao[k], bo[k])) return false;
  }
  // a stream in flight changes its text with every chunk; until it lands
  // only the version it is writing counts
  return a.data.isLoading || b.data.isLoading ? sameVersion(a.data, b.data) : sameContent(a.data, b.data);
}

function sameEdge(a: ThoughtEdge, b: ThoughtEdge): boolean {
  const ao = a as unknown as Record<string, unknown>;
  const bo = b as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
    if (k !== 'selected' && !same(ao[k], bo[k])) return false;
  }
  return true;
}

/** Whether two canvases hold the same things the person made. */
export function sameGraph(a: Snapshot, b: Snapshot): boolean {
  if (a.nodes === b.nodes && a.edges === b.edges) return true;
  return sameById(a.nodes, b.nodes, sameNode) && sameById(a.edges, b.edges, sameEdge);
}

const QUIET: Partial<ThoughtData> = { isLoading: false, isEditing: false, isEditingResponse: false, restreaming: undefined, pendingApprovals: undefined, agentTrace: undefined, reasoning: undefined, recallProgress: undefined };

function restoreData(target: ThoughtData, live: ThoughtData | undefined): ThoughtData {
  if (!live) {
    const quiet = { ...target, ...QUIET };
    if (target.attachments?.some((a) => a.isExtracting)) quiet.attachments = target.attachments.map((a) => (a.isExtracting ? { ...a, isExtracting: false } : a));
    return quiet;
  }
  if (sameContent(target, live)) return live;
  const data = { ...target } as Record<string, unknown>;
  const cur = live as unknown as Record<string, unknown>;
  for (const k of [...TRANSIENT, ...SETTINGS]) data[k] = cur[k];
  if (target.question === live.question && target.response === live.response && same(target.responses, live.responses)) {
    for (const k of DERIVED) data[k] = cur[k];
  }
  const liveAtts = new Map((live.attachments ?? []).map((a) => [a.id, a]));
  data.attachments = (target.attachments ?? []).map((a) => {
    const la = liveAtts.get(a.id);
    if (la && sameAttachment(a, la)) return la;
    return a.isExtracting ? { ...a, isExtracting: false } : a;
  });
  return data as unknown as ThoughtData;
}

/** The canvas a snapshot describes, with the live canvas's working state laid over it. */
function restore(target: Snapshot, live: Snapshot): Snapshot {
  const liveNodes = new Map(live.nodes.map((n) => [n.id, n]));
  const liveEdges = new Map(live.edges.map((e) => [e.id, e]));
  const nodes = target.nodes.map((n) => {
    const cur = liveNodes.get(n.id);
    if (cur === n) return n;
    // a node still streaming keeps its live self (undo checked the step leaves it be)
    if (cur?.data.isLoading) return cur;
    const data = restoreData(n.data, cur?.data);
    return { ...n, selected: cur?.selected ?? false, measured: cur?.measured ?? n.measured, data };
  });
  const edges = target.edges.map((e) => {
    const cur = liveEdges.get(e.id);
    if (cur && (cur === e || sameEdge(cur, e))) return cur;
    return e.selected ? { ...e, selected: false } : e;
  });
  return { nodes, edges };
}

/** A step may not remove or rewrite a node whose answer is still streaming. */
function touchesStream(target: Snapshot, live: Snapshot): boolean {
  const byId = new Map(target.nodes.map((n) => [n.id, n]));
  return live.nodes.some((n) => {
    if (!n.data.isLoading) return false;
    const was = byId.get(n.id);
    return !was || !sameVersion(was.data, n.data);
  });
}

/** What the undo and redo buttons can do right now. */
export function undoState(s: Pick<StoreState, 'nodes' | 'edges' | 'history' | 'historyIndex'>): { canUndo: boolean; canRedo: boolean } {
  const top = s.history[s.historyIndex];
  const dirty = !top || !sameGraph(top, { nodes: s.nodes, edges: s.edges });
  return { canUndo: s.historyIndex > 0 || dirty, canRedo: !dirty && s.historyIndex < s.history.length - 1 };
}

export const createHistorySlice: StateCreator<StoreState, [], [], HistorySlice> = (set, get) => ({
  history: [{ nodes: [], edges: [] }],
  historyIndex: 0,

  pushHistory: () => {
    const { nodes, edges, history, historyIndex } = get();
    const live = { nodes, edges };
    const top = history[historyIndex];
    if (top && sameGraph(top, live)) {
      // nothing the person made changed: refresh the snapshot in place (it
      // picks up plaques and ladders written since) and keep the redo path
      if (top.nodes !== nodes || top.edges !== edges) {
        const next = history.slice();
        next[historyIndex] = live;
        set({ history: next });
      }
      return;
    }
    const next = history.slice(0, historyIndex + 1);
    next.push(live);
    if (next.length > HISTORY_LIMIT) next.shift();
    set({ history: next, historyIndex: next.length - 1 });
  },

  settleNode: (nodeId: string, pending = (d: ThoughtData) => d.isLoading) => {
    // what the app fills in is part of the step that asked for it: snapshots
    // taken while it was pending get the finished node, so undoing a later
    // step never brings back a half-written answer or a spinner
    const { nodes, history } = get();
    const done = nodes.find((n) => n.id === nodeId);
    if (done && !pending(done.data)) {
      const inFlight = (n: ThoughtNode) => n.id === nodeId && pending(n.data);
      const next = history.map((s) => (s.nodes.some(inFlight)
        ? { ...s, nodes: s.nodes.map((n) => (inFlight(n) ? { ...n, data: done.data } : n)) }
        : s));
      set({ history: next });
    }
    get().pushHistory();
  },

  undo: () => {
    if (condenseGuard()) return;
    const { nodes, edges, history, historyIndex } = get();
    const live = { nodes, edges };
    const top = history[historyIndex];
    // an unrecorded change is the step to take back
    const dirty = !top || !sameGraph(top, live);
    const target = dirty ? top : history[historyIndex - 1];
    if (!target) return;
    if (touchesStream(target, live)) { toast('info', t('toast.undoWhileGenerating')); return; }
    let next = history;
    let index = historyIndex;
    if (dirty) {
      next = history.slice(0, historyIndex + 1);
      next.push(live);
      if (next.length > HISTORY_LIMIT) next.shift();
      index = next.length - 1;
    } else if (top.nodes !== nodes || top.edges !== edges) {
      next = history.slice();
      next[historyIndex] = live;
    }
    const restored = restore(target, live);
    set({ nodes: restored.nodes, edges: restored.edges, history: next, historyIndex: index - 1 });
    get().logEvent('undo');
  },

  redo: () => {
    if (condenseGuard()) return;
    const { nodes, edges, history, historyIndex } = get();
    const live = { nodes, edges };
    const top = history[historyIndex];
    // a change made since the undo starts a new path: record it, nothing to redo
    if (!top || !sameGraph(top, live)) { get().pushHistory(); return; }
    if (historyIndex >= history.length - 1) return;
    const target = history[historyIndex + 1];
    if (touchesStream(target, live)) { toast('info', t('toast.undoWhileGenerating')); return; }
    const next = top.nodes !== nodes || top.edges !== edges ? history.map((s, i) => (i === historyIndex ? live : s)) : history;
    const restored = restore(target, live);
    set({ nodes: restored.nodes, edges: restored.edges, history: next, historyIndex: historyIndex + 1 });
    get().logEvent('redo');
  },
});
