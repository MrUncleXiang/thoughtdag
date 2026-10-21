import { useState } from 'react';
import { ChevronDown, ChevronRight, History, Loader2, X, RotateCcw } from 'lucide-react';
import { useStore } from '../../store';
import { recallTokens, recallMore, recallHeld } from '../../lib/recall';
import { JUDGE_LABELS, type JudgeProviderId } from '../../lib/judge';
import { useT, fmt } from '../../i18n';
import type { RecallItem, RecallMeta } from '../../types';

// What recall brought into this node, as the person reads it: one line
// saying what came in, then a card per item (the dossier first), each
// removable; the verbatim text one click away. The numbers behind the
// choice — candidates, probabilities, budget, the judge — sit folded under
// "how it was chosen". What you see included is what the model read.

const cardLine = (i: RecallItem): string => {
  if (i.card) return i.card;
  const firstLine = i.text.replace(/^\*\*Q\*\*\s*/i, '').split('\n').map((l) => l.replace(/^[#*>\s-]+/, '').trim()).find((l) => l.length > 0) ?? '';
  return firstLine.slice(0, 120);
};
const day = (at?: string) => (at ? at.slice(5, 10) : '');

export default function RecallSection({ nodeId, items, meta, recallOn, progress }: { nodeId: string; items: RecallItem[] | undefined; meta?: RecallMeta; recallOn: boolean; progress?: { done: number; total: number } | null }) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const [how, setHow] = useState(false);
  const [unfolded, setUnfolded] = useState<string | null>(null);
  const [more, setMore] = useState<'idle' | 'busy' | 'none'>('idle');
  const [heldBusy, setHeldBusy] = useState(false);
  if (!recallOn) {
    // off: no menu; a node that still carries items from an earlier ask says so in one line
    if (!items?.length) return null;
    return <section className="px-4 py-2 border-b border-line text-2xs text-ink-faint" data-recall-section data-recall-off>{fmt(t('panel.recallOffHint'), { n: items.length })}</section>;
  }
  const loadMore = async () => {
    setMore('busy');
    try { const n = await recallMore(nodeId); setMore(n === 0 ? 'none' : 'idle'); } catch { setMore('idle'); }
  };
  // leaving an item out changes the context: a step
  const toggle = (id: string) => {
    useStore.getState().pushHistory();
    useStore.setState((s) => ({
      nodes: s.nodes.map((n) => (n.id === nodeId
        ? { ...n, data: { ...n.data, recallItems: (n.data.recallItems ?? []).map((i) => (i.id === id ? { ...i, excluded: !i.excluded } : i)) } }
        : n)),
    }));
    useStore.getState().pushHistory();
  };
  const total = recallTokens(items);
  const included = (items ?? []).filter((i) => !i.excluded);
  const dossiers = included.filter((i) => i.dossier);
  const turns = included.filter((i) => !i.dossier);
  const leadParts = [...dossiers.map((d) => fmt(t('panel.recallLeadDossier'), { name: d.dossier!.name })), ...(turns.length ? [fmt(t('panel.recallLeadTurns'), { n: turns.length })] : [])];
  const excerpts = (items ?? []).some((i) => !i.dossier);
  return (
    <section className="px-4 py-3 border-b border-line" data-recall-section>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 text-left">
        {open ? <ChevronDown size={14} strokeWidth={1.75} className="text-ink-faint" /> : <ChevronRight size={14} strokeWidth={1.75} className="text-ink-faint" />}
        <History size={14} strokeWidth={1.75} className="text-accent" />
        <span className="text-xs font-medium text-ink flex-1">{t('panel.recall')}</span>
        {!!items?.length && <span className="text-2xs text-ink-faint font-mono" data-recall-total>{total} tok</span>}
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {!items && <p className="text-2xs text-ink-faint italic" data-recall-progress={progress ? `${progress.done}/${progress.total}` : undefined}>{progress ? fmt(t('panel.recallJudging'), { done: progress.done, total: progress.total }) : t('panel.recallEmpty')}</p>}
          {items && items.length === 0 && <p className="text-2xs text-ink-faint italic">{t('panel.recallNone')}</p>}
          {items && items.length > 0 && <p className="text-2xs text-ink-muted" data-recall-lead>{leadParts.length ? fmt(t('panel.recallLead'), { what: leadParts.join(t('panel.recallLeadJoin')) }) : t('panel.recallAllOff')}</p>}
          {(items ?? []).map((i) => (
            <div key={i.id} className={`rounded-lg border px-2.5 py-1.5 ${i.dossier ? 'border-accent/40 bg-accent/10' : 'border-line/70'} ${i.excluded ? 'opacity-50' : ''}`} data-recall-item={i.excluded ? 'excluded' : 'included'} data-recall-item-kind={i.dossier ? 'dossier' : i.kind}>
              <div className="flex items-start gap-2">
                <button onClick={() => setUnfolded(unfolded === i.id ? null : i.id)} className="flex-1 min-w-0 text-left">
                  <div className={`text-2xs text-ink leading-relaxed ${i.excluded ? 'line-through' : ''}`}>{i.dossier ? fmt(t('dossier.title'), { name: i.dossier.name }) : cardLine(i)}</div>
                  <div className="text-2xs text-ink-faint mt-0.5 flex items-center gap-1.5 flex-wrap">
                    {i.dossier
                      ? <span>{t('dossier.updated')} {i.dossier.updatedAt.slice(0, 10)}</span>
                      : <span className="font-mono border border-line rounded px-1 py-px" title={i.file}>{i.runner} · {day(i.at)}</span>}
                    <span className="font-mono">{i.card ? i.cardTokens ?? 0 : i.tokens} tok</span>
                    {i.relevance !== undefined && <span className="sr-only" data-recall-relevance>{i.relevance.toFixed(2)}</span>}
                  </div>
                </button>
                <button
                  onClick={() => toggle(i.id)}
                  className="shrink-0 text-ink-faint hover:text-ink w-6 h-6 rounded-full flex items-center justify-center hover:bg-wash transition-colors"
                  title={i.excluded ? t('panel.recallInclude') : t('panel.recallExclude')}
                  data-recall-item-toggle
                >
                  {i.excluded ? <RotateCcw size={12} strokeWidth={1.75} /> : <X size={12} strokeWidth={1.75} />}
                </button>
              </div>
              {unfolded === i.id && (
                <div className="mt-1.5 text-2xs text-ink-muted leading-relaxed whitespace-pre-wrap break-words max-h-[260px] overflow-y-auto border-l-2 border-line pl-2 nowheel" data-recall-item-text>{i.card && !i.dossier && <div className="mb-1.5 text-ink"><span className="text-ink-faint">{t('panel.recallCardLabel')} </span>{i.card}</div>}{i.text}</div>
              )}
            </div>
          ))}
          {items && items.length > 0 && (
            <div className="flex items-center gap-3 pt-0.5">
              <button onClick={() => setHow((v) => !v)} className="text-2xs text-ink-faint hover:text-ink flex items-center gap-1" data-recall-how>
                {how ? <ChevronDown size={11} /> : <ChevronRight size={11} />} {t('panel.recallHow')}
              </button>
              {excerpts && (
                <button onClick={() => void loadMore()} disabled={more !== 'idle'} className="text-2xs text-accent hover:bg-accent/10 px-1.5 py-0.5 rounded-md disabled:opacity-50 flex items-center gap-1" data-recall-more>
                  {more === 'busy' && <Loader2 size={11} className="animate-spin" />}
                  {more === 'none' ? t('panel.recallNoMore') : t('panel.recallMore')}
                </button>
              )}
            </div>
          )}
          {how && meta && (
            <div className="text-2xs text-ink-muted space-y-0.5 pl-4 border-l border-line" data-recall-meta>
              {!!meta.topics?.length && <div data-recall-topics>{fmt(t('panel.recallTopics'), { t: meta.topics.map((x) => `${x.name} ${x.p.toFixed(2)}`).join(' · ') })}</div>}
              {meta.detail !== undefined && <div data-recall-detail>{fmt(t(meta.detail >= 0.5 ? 'panel.recallDetailYes' : 'panel.recallDetailNo'), { p: meta.detail.toFixed(2) })}</div>}
              {meta.corrections.map((c) => <div key={c.from}>{fmt(t('panel.recallCorrected'), { a: c.from, b: c.to })}{c.p !== undefined ? ` · ${c.p.toFixed(2)}` : ''}</div>)}
              {meta.pool > 0 && <div>{fmt(t('panel.recallKept'), { n: meta.pool, k: (items ?? []).filter((i) => !i.dossier).length })}{meta.dropped ? ` · ${fmt(t('panel.recallDropped'), { n: meta.dropped })}` : ''}</div>}
              {!!meta.heldBack?.length && (
                <div className="flex items-center gap-2" data-recall-held>
                  <span>{fmt(t('panel.recallHeld'), { n: meta.heldBack.length })}</span>
                  <button onClick={() => { setHeldBusy(true); void recallHeld(nodeId).finally(() => setHeldBusy(false)); }} disabled={heldBusy} className="text-accent hover:bg-accent/10 px-1.5 py-0.5 rounded disabled:opacity-50" data-recall-held-add>{heldBusy ? '…' : t('panel.recallHeldAdd')}</button>
                </div>
              )}
              {meta.budget ? <div className="flex items-center gap-2 flex-wrap">{fmt(t('panel.recallUsed'), { b: meta.budget, u: total })}</div> : null}
              {meta.reach && <div>{fmt(t('panel.recallReach'), { r: t(meta.reach === 'light' ? 'recall.reachLight' : meta.reach === 'deep' ? 'recall.reachDeep' : 'recall.reachFull') })}</div>}              {meta.judge && <div>{fmt(t('panel.recallJudge'), { j: JUDGE_LABELS[meta.judge.provider as JudgeProviderId] ?? meta.judge.provider })} · {t(meta.judge.calibrated ? 'judge.calibrated' : 'judge.uncalibrated')}</div>}
              {meta.judgeError && <div className="text-amber-600">{fmt(t('panel.recallJudgeFailed'), { e: meta.judgeError })}</div>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
