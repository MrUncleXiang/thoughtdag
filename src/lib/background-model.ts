// Background calls: what the canvas asks a model on the person's behalf
// without them choosing one for it. Plaques and ladders, material labels,
// memory and profile lines, recall cards and topics, the journey line, the
// recap, the thought map's title. They are not questions, so the picker does
// not decide alone, and an agent never takes them: an agent run is a session
// with tools (a Harness Agent id reaches the plugin's agent route and would
// run a whole turn to write one plaque).
//
// One order for every caller, after the caller's own preference:
//   the API model picked now → the API model picked last (kept while the
//   picker is on an agent) → the list's default → the other API models in
//   list order.
// Only models the list knows are tried: the proxy answers an id it does not
// know with its default, silently. A call tries at most three models; one
// that failed waits behind the others for ten minutes, so a dead model does
// not cost every call a round trip. An empty answer counts as a failure,
// since nothing downstream can use it. What the proxy adds on its own (a fast
// call's reasoning switch) never makes a call fail (server.mjs).
//
// Before this, each caller picked on its own: the picked model (an agent id
// when the picker was on one), the list's default, or the first model of the
// first interface for agent answers; and one failure was final and silent.
// On 2026-10-22 every Claude Code answer on a canvas went without a plaque
// because the first interface model refused the fast call's reasoning switch.
import { llmCallAnswered, type ContextMessage, type ImageAttachment } from './api';
import { getModelsOnce } from './use-models';
import { isAgentModel } from './agents/agent-runtime';
import { isHarnessAgentModel } from './atlas/dsh-bridge';
import { useUiStore } from './ui-store';

/** An ordinary API model: not an agent runtime, not the Harness Agent. */
export const isApiModel = (id: string | null | undefined): id is string => !!id && !isAgentModel(id) && !isHarnessAgentModel(id);

/** The models that can read an image for the canvas (image text, PDF pages). Agents declare vision too, and an
 *  agent's name ranked it first ("opus"), so reading one image sent an agent id down the plain route: the proxy
 *  answered with a stand-in under the agent's name, the Harness ran a whole agent turn. */
export const apiVisionModels = <M extends { id: string; vision: boolean }>(models: M[]): M[] => models.filter((m) => m.vision && isApiModel(m.id));

const LAST_API_KEY = 'thoughtdag.lastApiModel';
const MAX_MODELS_PER_CALL = 3;
const COOL_DOWN_MS = 10 * 60_000;
/** a background call that has not answered by then has failed (a slow thinking model writes a ladder in about a minute) */
export const BACKGROUND_TIMEOUT_MS = 180_000;

const readLast = (): string | null => { try { return localStorage.getItem(LAST_API_KEY); } catch { return null; } };
let lastApi: string | null = readLast();
const remember = (id: string | null) => {
  if (!isApiModel(id) || id === lastApi) return;
  lastApi = id;
  try { localStorage.setItem(LAST_API_KEY, id); } catch { /* kept for this session */ }
};
// Watched from the moment the module graph has loaded, not while it loads: the agent check lives in a module
// that may still be initialising when this one runs (store → streaming → here → agents → store), and touching
// it then stopped the app from starting with an agent picked.
queueMicrotask(() => {
  remember(useUiStore.getState().selectedModel);
  useUiStore.subscribe((s) => remember(s.selectedModel));
});

const failedAt = new Map<string, number>();
const cooling = (id: string) => Date.now() - (failedAt.get(id) ?? -Infinity) < COOL_DOWN_MS;

/** The models a background call would try, in order: the preferred ones first, models that failed lately last. */
export async function backgroundModels(prefer: (string | null | undefined)[] = []): Promise<string[]> {
  const md = await getModelsOnce().catch(() => null);
  const known = md?.models.length ? new Set(md.models.map((m) => m.id)) : null;
  const order = [...prefer, useUiStore.getState().selectedModel, lastApi, md?.default, ...(md?.models ?? []).map((m) => m.id)];
  const out: string[] = [];
  for (const id of order) if (isApiModel(id) && (!known || known.has(id)) && !out.includes(id)) out.push(id);
  return [...out.filter((id) => !cooling(id)), ...out.filter(cooling)];
}

/** No model answered: each one tried, with what it said. Empty when there was no API model to try at all. */
export class BackgroundCallError extends Error {
  readonly tried: { model: string; error: string }[];
  constructor(tried: { model: string; error: string }[]) {
    super(tried.length ? tried.map((x) => `${x.model}: ${x.error}`).join(' · ') : 'no API model to call');
    this.name = 'BackgroundCallError';
    this.tried = tried;
  }
}

/** One background call: the first model in the order that answers, and which one it was. */
export async function backgroundCall(
  messages: ContextMessage[],
  opts: { prefer?: (string | null | undefined)[]; fast?: boolean; images?: ImageAttachment[]; /** per model tried */ timeoutMs?: number } = {},
): Promise<{ text: string; model: string }> {
  const models = (await backgroundModels(opts.prefer)).slice(0, MAX_MODELS_PER_CALL);
  const tried: { model: string; error: string }[] = [];
  for (const model of models) {
    try {
      const r = await llmCallAnswered(messages, opts.images, model, { fast: opts.fast, timeoutMs: opts.timeoutMs ?? BACKGROUND_TIMEOUT_MS });
      if (!r.text?.trim()) throw new Error('empty answer');
      failedAt.delete(model);
      return { text: r.text, model: r.model ?? model };
    } catch (e) {
      failedAt.set(model, Date.now());
      tried.push({ model, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
    }
  }
  throw new BackgroundCallError(tried);
}
