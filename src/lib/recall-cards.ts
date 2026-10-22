// Item cards: a recalled turn condensed to a few lines by a cheap model,
// kept in IndexedDB by session and turn so it is paid for once. The model
// reads the card; the person can always unfold the verbatim text in the
// panel. Cards are made in the background after a recall, so an ask never
// waits for them — the first time, the clipped text goes in instead.
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { backgroundCall } from './background-model';
import { getModelsOnce } from './use-models';
import { useStore } from '../store';
import { countTokens } from '../utils';
import type { RecallItem } from '../types';

const key = (session: string, turn: number) => `td:card:${session}#${turn}`;
const CARD_CAP_CHARS = 420;
let inflight = 0;
const MAX_INFLIGHT = 4;

export async function cachedCard(session: string, turn: number): Promise<string | undefined> {
  try { const v = await idbGet<string>(key(session, turn)); return typeof v === 'string' && v ? v : undefined; } catch { return undefined; }
}

/** Condense one recalled text into a card and remember it. */
export async function makeCard(session: string, turn: number, text: string): Promise<string | undefined> {
  const bg = (await getModelsOnce())?.default ?? undefined;
  const prompt = `Condense the past exchange below into a card of at most 60 words (or 120 Chinese characters), in the exchange's own language: what was asked, what was concluded or decided, the names, numbers and file names that matter. No preamble, no markdown. Output only the card.\n\n${text.slice(0, 6000)}`;
  const { text: raw } = await backgroundCall([{ role: 'user', content: prompt }], { prefer: [bg] });
  const card = raw.trim().replace(/^["“「]|["”」]$/g, '').slice(0, CARD_CAP_CHARS);
  if (card.length < 20) return undefined;
  try { await idbSet(key(session, turn), card); } catch { /* the card still serves this once */ }
  return card;
}

/** After a recall: make the missing cards in the background (a few at a
 *  time) and put them on the node's items, so the next ask can read cards. */
export function fillCards(nodeId: string, items: RecallItem[]): void {
  const missing = items.filter((i) => !i.card);
  if (!missing.length) return;
  void (async () => {
    for (const item of missing) {
      while (inflight >= MAX_INFLIGHT) await new Promise((r) => setTimeout(r, 200));
      inflight++;
      makeCard(item.session, item.turn, item.text)
        .then((card) => {
          if (!card) return;
          useStore.setState((s) => ({
            nodes: s.nodes.map((n) => (n.id === nodeId && n.data.recallItems?.some((x) => x.id === item.id)
              ? { ...n, data: { ...n.data, recallItems: n.data.recallItems!.map((x) => (x.id === item.id ? { ...x, card, cardTokens: countTokens(card) } : x)) } }
              : n)),
          }));
        })
        .catch(() => undefined)
        .finally(() => { inflight--; });
    }
  })();
}
