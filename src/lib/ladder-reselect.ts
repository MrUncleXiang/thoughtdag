// "Update node summaries": the selected nodes' active versions get a
// written ladder (lib/ladder.ts) from the model picked in the model picker
// (the person asked, so their pick wins), else the model that wrote the
// answer, then the shared background order when one fails
// (lib/background-model.ts). Files, notes, answers still
// generating and short answers are skipped, not failed. Three run at a time;
// progress shows in the bottom-right card (components/ui/LadderJobCard),
// which can stop the job: nodes not yet started are left as they are, the
// ones in flight finish. Until a node's ladder lands, its plaque keeps the
// local one.
import { useStore } from '../store';
import { toast, useUiStore, type LadderJob } from './ui-store';
import { t, fmt } from '../i18n';
import { buildLadder, ladderPreference, inFlight } from './ladder';
import { ladderContextFor } from './ladder-context';
import { backgroundModels, BackgroundCallError } from './background-model';
import { describeModel } from './use-models';
import { SUMMARY_MIN_CHARS } from '../store/streaming';

/** What an explicit update asks first: the picked model (the person asked, so their pick
 *  wins; an agent pick drops out in the shared order), then the node's own preference. */
function preferenceFor(nodeId: string): (string | null | undefined)[] {
  const n = useStore.getState().nodes.find((x) => x.id === nodeId);
  return [useUiStore.getState().selectedModel, ...ladderPreference(n?.data.generatedBy?.[n.data.responseIndex] ?? undefined)];
}

/** Whether a node has an answer worth selecting from (thought nodes with a long enough active answer). */
export function reselectable(nodeId: string): boolean {
  const n = useStore.getState().nodes.find((x) => x.id === nodeId);
  if (!n || n.data.stepKind || n.data.isLoading) return false;
  const response = n.data.responses?.[n.data.responseIndex] ?? n.data.response;
  return (response?.length ?? 0) >= SUMMARY_MIN_CHARS;
}

const patch = (fn: (j: LadderJob) => Partial<LadderJob>) => useUiStore.getState().setLadderJob((j) => (j ? { ...j, ...fn(j) } : j));

/** 'unreachable': no model answered at all (as opposed to an answer the ladder could not use) */
async function updateOne(nodeId: string): Promise<'done' | 'failed' | 'unreachable' | 'skipped'> {
  const n = useStore.getState().nodes.find((x) => x.id === nodeId);
  if (!n || !reselectable(nodeId)) return 'skipped';
  const response = n.data.responses[n.data.responseIndex] ?? n.data.response;
  inFlight.add(nodeId);
  try {
    // one more try after a pause, whether no model answered (rate limit, a dropped connection) or the
    // selection came back unusable: a second sampling usually lands
    let ladder = null; let lastError = ''; let unreachable = false;
    for (let attempt = 0; attempt < 2 && !ladder; attempt++) {
      try { const st = useStore.getState(); ladder = await buildLadder(n.data.question, response, preferenceFor(nodeId), ladderContextFor(nodeId, st.nodes, st.edges)); unreachable = false; }
      catch (e) { lastError = e instanceof Error ? e.message : String(e); unreachable = e instanceof BackgroundCallError; }
      if (!ladder && attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    }
    // a stopped job keeps the reason it stopped for; a node still in flight then does not overwrite it
    if (!ladder) { if (lastError) patch((j) => (j.cancelled ? {} : { lastError: lastError.slice(0, 120) })); return unreachable ? 'unreachable' : 'failed'; }
    useStore.getState().setLadder(nodeId, response, ladder);
    return 'done';
  } finally { inFlight.delete(nodeId); }
}

/** nodes in a row that no model answered, after which a job stops */
const HALT_AFTER = 3;

/** Stop the running job: nothing new starts, what is in flight finishes. */
export function stopLadderJob(): void { patch(() => ({ cancelled: true })); }
export function dismissLadderJob(): void { useUiStore.getState().setLadderJob(null); }

/** Update the summaries of these nodes (one from the right-click menu, many from the selection toolbar). */
export async function updateSummaries(nodeIds: string[]): Promise<{ done: number; skipped: number; failed: number }> {
  if (useUiStore.getState().ladderJob?.running) { toast('info', t('ladder.jobBusy')); return { done: 0, skipped: 0, failed: 0 }; }
  const eligible = nodeIds.filter(reselectable);
  const skipped = nodeIds.length - eligible.length;
  if (!eligible.length) { toast('info', t('ladder.batchNone')); return { done: 0, skipped, failed: 0 }; }
  // the card names the model the job starts on; a node whose model fails is written by the next in the order
  const [model] = await backgroundModels(preferenceFor(eligible[0]));
  if (!model) { toast('info', t('ladder.noModel')); return { done: 0, skipped, failed: 0 }; }
  useUiStore.getState().setLadderJob({ total: eligible.length, done: 0, failed: 0, skipped, model: describeModel(model), running: true, cancelled: false });
  const queue = [...eligible];
  // When no model answers for several nodes in a row the setup is what fails (a dead key, no network), not the
  // nodes: the job stops and says why, instead of sending every remaining node into the same wall
  let unreachableInARow = 0; let running = 0;
  const stopped = () => !!useUiStore.getState().ladderJob?.cancelled;
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length && !stopped()) {
      // after a node no model answered, the next one waits for those in flight: three in a row then means three
      // nodes, not three plus whatever the other workers had already started; an answer restores the pace
      while (unreachableInARow > 0 && running > 0 && !stopped()) await new Promise((r) => setTimeout(r, 100));
      if (!queue.length || stopped()) break;
      const id = queue.shift()!;
      running++;
      const out = await updateOne(id).finally(() => { running--; });
      unreachableInARow = out === 'unreachable' ? unreachableInARow + 1 : out === 'skipped' ? unreachableInARow : 0;
      patch((j) => (out === 'done' ? { done: j.done + 1 } : out === 'skipped' ? { skipped: j.skipped + 1 } : { failed: j.failed + 1 }));
      if (unreachableInARow >= HALT_AFTER && !useUiStore.getState().ladderJob?.cancelled) {
        patch((j) => ({ cancelled: true, lastError: fmt(t('ladder.jobHalted'), { n: HALT_AFTER, error: j.lastError ?? '' }) }));
      }
    }
  }));
  patch(() => ({ running: false, finishedAt: Date.now() }));
  const j = useUiStore.getState().ladderJob;
  return { done: j?.done ?? 0, skipped: j?.skipped ?? skipped, failed: j?.failed ?? 0 };
}
