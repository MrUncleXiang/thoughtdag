// Development only: a window hook for experiments on the ladder pipeline
// (which context a selection sees). Loaded from App in DEV builds; never
// part of a release bundle.
import { useStore } from '../store';
import { buildContext } from '../store/context-builder';
import { buildLadder, type LadderOptions } from './ladder';
import { ladderContextFor } from './ladder-context';
import { levelText } from './ladder-core';
import type { ContextMessage } from './api';

/** The compiled conversation a node's answer was generated from: its parent's context plus its own question. */
function compileFor(nodeId: string): ContextMessage[] {
  const st = useStore.getState();
  const node = st.nodes.find((n) => n.id === nodeId);
  const parent = st.edges.find((e) => e.target === nodeId && !e.data?.isCrossLink)?.source;
  const upstream = parent ? buildContext(parent, st.nodes, st.edges).messages : [];
  return [...upstream, { role: 'user', content: node?.data.question ?? '' }];
}

(window as unknown as { __ladderLab: unknown }).__ladderLab = {
  buildLadder, ladderContextFor, compileFor, levelText,
  /** one node three ways: the stored line, written with the thread in view, written from the answer alone; the full compiled context on request */
  async compare(nodeId: string, model: string, withFull = false) {
    const st = useStore.getState();
    const n = st.nodes.find((x) => x.id === nodeId);
    if (!n) return null;
    const idx = n.data.responseIndex;
    const response = n.data.responses?.[idx] ?? n.data.response;
    const ctx = ladderContextFor(nodeId, st.nodes, st.edges);
    const run = async (opts: LadderOptions) => { const l = await buildLadder(n.data.question, response, [model], opts); return l ? { topic: levelText(l, 0), takeaway: levelText(l, 1), brief: levelText(l, 2), abstract: levelText(l, 3), context: l.context, revision: !!l.revision, move: l.move ?? null } : null; };
    return { question: n.data.question, stored: n.data.summaries?.[idx] ?? null, storedTopic: n.data.summaryTopics?.[idx] ?? null, none: await run({}), thread: await run({ thread: ctx.thread, parentAnswer: ctx.parentAnswer }), full: withFull ? await run({ context: compileFor(nodeId), thread: ctx.thread, parentAnswer: ctx.parentAnswer }) : null, threadText: ctx.thread };
  },
};
