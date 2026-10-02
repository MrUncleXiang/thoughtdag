import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { History, ImageDown, Sparkles, X } from 'lucide-react';
import { useStore } from '../../store';
import { useUiStore } from '../../lib/ui-store';
import { useDateLocale, useI18n, useT, fmt } from '../../i18n';
import { collectTimeline } from '../../lib/timeline';
import { type LadderLevel } from '../../lib/ladder';
import { LadderMorph } from '../ZoomText';
import { useLadderCacheVersion } from '../../lib/local-ladder-cache';
import { generateGedankengang, getCached, graphFingerprint, type Gedankengang } from '../../lib/gedankengang';

// The third overview, after highlights and materials: the canvas as a
// chronicle. Every node in creation order, grouped by day, each row carrying
// its takeaway (or question), both timestamps, and a locate chip. The rail
// under the palette is for jumping while zoomed out; this is for reading the
// journey itself.

export default function TimelineOverviewModal({ onLocate }: { onLocate: (nodeId: string) => void }) {
  const open = useUiStore((s) => s.timelineOverviewOpen);
  const setOpen = useUiStore((s) => s.setTimelineOverviewOpen);
  const nodes = useStore((s) => s.nodes);
  const t = useT();
  const dateLocale = useDateLocale();
  const lang = useI18n((s) => s.lang);
  // The modal never renders the recent-edit glow, so the clock is moot: 0.
  const ladderVersion = useLadderCacheVersion();
  // closed: skip the walk, which reruns on every nodes change (a session import streams hundreds of them;
  // the materials and highlights overviews do the same, #58)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ladderVersion moves when a local ladder lands; the entries then carry it
  const entries = useMemo(() => (open ? collectTimeline(nodes, 0, { ladders: true }) : []), [open, nodes, ladderVersion]);
  // How much of each step to show. The slider is continuous, like the canvas
  // zoom: type size and row spacing follow it smoothly, and the text level
  // (topic, takeaway, brief, abstract) hands off at the half-steps with the
  // same word morph the plaques use. The modal keeps one height throughout.
  const [detail, setDetail] = useState(1);
  const level = Math.round(detail) as LadderLevel;
  // no CSS transition on the padding: the slider moves in hundredths, and exact layout is needed to hold the anchor below
  const rowStyle = { paddingTop: 4 + detail * 5, paddingBottom: 4 + detail * 5 };
  // Zoom around the reader's place: the row under the pointer (else the one at the middle of the list) keeps its
  // position on screen while rows grow or shrink, like the canvas zooming around the cursor.
  const listRef = useRef<HTMLDivElement>(null);
  const hoverId = useRef<string | null>(null);
  const anchor = useRef<{ id: string; y: number } | null>(null);
  const changeDetail = (v: number) => {
    const list = listRef.current;
    if (list) {
      const listTop = list.getBoundingClientRect().top;
      const rows = [...list.querySelectorAll<HTMLElement>('[data-entry]')];
      let row = hoverId.current ? rows.find((r) => r.dataset.entry === hoverId.current) ?? null : null;
      if (!row) { const mid = listTop + list.clientHeight / 2; row = rows.reduce<HTMLElement | null>((best, r) => { const b = r.getBoundingClientRect(); const d = Math.abs((b.top + b.bottom) / 2 - mid); return !best || d < Math.abs((best.getBoundingClientRect().top + best.getBoundingClientRect().bottom) / 2 - mid) ? r : best; }, null); }
      anchor.current = row ? { id: row.dataset.entry!, y: row.getBoundingClientRect().top - listTop } : null;
    }
    setDetail(v);
  };
  useLayoutEffect(() => {
    const list = listRef.current; const a = anchor.current; if (!list || !a) return;
    const row = list.querySelector<HTMLElement>(`[data-entry="${a.id}"]`); if (!row) return;
    const y = row.getBoundingClientRect().top - list.getBoundingClientRect().top;
    list.scrollTop += y - a.y;
  }, [detail]);
  const fontPx = 13 + detail * 0.9;
  // The journey paragraph: session-cached per (graph fingerprint, interface
  // language) — reopening is free until the map changes, and switching the
  // language toggle narrates in the other language.
  const fp = useMemo(() => (open ? graphFingerprint(nodes) : ''), [open, nodes]);
  const [ged, setGed] = useState<Gedankengang | null>(null);
  const [gedLoading, setGedLoading] = useState(false);
  const [gedFailed, setGedFailed] = useState(false);
  // Prefer the cache for the CURRENT (graph, language) pair; fall back to
  // the last generated one so a stale/other-language paragraph still shows,
  // dimmed, with the regenerate affordance.
  const shown = getCached(fp, lang) ?? ged;
  const stale = !!shown && (shown.fp !== fp || shown.lang !== lang);
  const writeJourney = () => {
    setGedLoading(true);
    setGedFailed(false);
    const { nodes: ns, edges: es } = useStore.getState();
    generateGedankengang(ns, es, lang)
      .then(setGed)
      .catch(() => setGedFailed(true))
      .finally(() => setGedLoading(false));
  };
  if (!open) return null;

  const close = () => setOpen(false);
  const dayOf = (iso?: string) => (iso ? iso.slice(0, 10) : '');
  const fmtClock = (iso?: string) =>
    iso ? new Date(iso).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' }) : '—';

  return createPortal((
    <div className="fixed inset-0 z-[60] bg-ink/30 backdrop-blur-sm flex items-center justify-center p-6" onClick={close}>
      <div className="bg-card rounded-2xl shadow-2xl border border-line w-[640px] h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3 border-b border-line shrink-0">
          <History size={15} strokeWidth={1.75} className="text-accent" />
          <span className="text-sm font-semibold text-ink">{t('tlov.title')}</span>
          <span className="text-2xs text-ink-faint">{fmt(t('tlov.count'), { n: entries.length })}</span>
          <label className="flex items-center gap-2 ml-3 text-2xs text-ink-faint" title={t('tlov.detailTitle')}>
            <span>{t('tlov.detail')}</span>
            <input type="range" min={0} max={3} step={0.01} value={detail} onChange={(e) => changeDetail(Number(e.target.value))} className="w-28 accent-accent" data-tlov-detail />
            <span className="text-ink-muted w-8">{t(`ladder.level${level}` as 'ladder.level0')}</span>
          </label>
          <div className="flex-1" />
          <button
            onClick={() => { close(); useUiStore.getState().setThoughtMapOpen(true); }}
            disabled={entries.length === 0}
            data-tmap-from-timeline
            className="flex items-center gap-1.5 text-2xs text-ink-muted hover:text-accent hover:bg-accent/10 rounded-full px-2.5 py-1 transition-colors disabled:opacity-50"
          >
            <ImageDown size={13} strokeWidth={1.75} />
            {t('tmap.export')}
          </button>
          <button onClick={close} className="text-ink-faint hover:text-ink w-7 h-7 rounded-lg hover:bg-wash flex items-center justify-center transition-colors">
            <X size={15} strokeWidth={1.75} />
          </button>
        </div>

        <div className="px-5 pt-3 shrink-0" data-gedankengang>
          {!shown && !gedLoading && (
            <button
              onClick={writeJourney}
              className="flex items-center gap-1.5 text-2xs text-accent bg-accent/10 hover:bg-accent/20 rounded-full px-3 py-1.5 transition-colors"
            >
              <Sparkles size={12} strokeWidth={1.75} />
              {t('tlov.gedankenGenerate')}
            </button>
          )}
          {gedLoading && (
            <p className="text-2xs text-ink-faint italic py-1.5">{t('tlov.gedankenLoading')}</p>
          )}
          {gedFailed && !gedLoading && (
            <p className="text-2xs text-red-500 py-1">{t('tlov.gedankenFailed')}</p>
          )}
          {shown && !gedLoading && (
            <div className={`rounded-xl bg-wash px-4 py-3 ${stale ? 'opacity-60' : ''}`}>
              <p className="text-sm text-ink leading-relaxed">{shown.text}</p>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-2xs text-ink-faint">
                  {stale ? t('tlov.gedankenStale') : new Date(shown.at).toLocaleString(dateLocale)}
                </span>
                {stale && (
                  <button onClick={writeJourney} className="text-2xs text-accent hover:underline">
                    {t('tlov.gedankenRedo')}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-3" data-timeline-overview>
          {entries.length === 0 && <p className="text-xs text-ink-faint italic py-2">{t('tlov.empty')}</p>}
          {entries.map((e, i) => {
            const prevDay = i > 0 ? dayOf(entries[i - 1].createdAt) : undefined;
            const day = dayOf(e.createdAt);
            const newDay = i === 0 || day !== prevDay;
            return (
              <div key={e.id}>
                {newDay && (
                  <div className="sticky top-0 bg-card text-2xs text-ink-faint font-medium pt-3 pb-1 first:pt-0">
                    {day || t('tlov.undated')}
                  </div>
                )}
                <div className="group flex items-start gap-2.5 border-b border-line/50 last:border-0" style={rowStyle} data-entry={e.id} onMouseEnter={() => { hoverId.current = e.id; }} onMouseLeave={() => { if (hoverId.current === e.id) hoverId.current = null; }}>
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: e.color, opacity: e.archived ? 0.35 : 1 }}
                  />
                  <span className="text-2xs font-mono text-ink-faint shrink-0 w-11">{fmtClock(e.createdAt)}</span>
                  <div className="flex-1 min-w-0">
                    {e.ladder ? (
                      // the level whole, morphing word by word as the slider crosses a half-step; the shorter level's words keep full ink
                      <div className={e.archived ? 'opacity-50 line-through' : ''}><LadderMorph ladder={e.ladder} level={level} fontSize={fontPx} weight={e.badged ? 'font-semibold' : 'font-medium'} className="whitespace-pre-wrap break-words" /></div>
                    ) : (
                      // no ladder (a short answer): the takeaway, or the topic at the lowest level
                      <p className={`leading-snug whitespace-pre-wrap break-words ${e.archived ? 'text-ink-faint line-through' : e.badged ? 'text-ink' : 'text-ink-muted'}`} style={{ fontSize: fontPx, transition: 'font-size 160ms ease-out' }}>
                        {level === 0 ? (e.topic || e.label || '…') : <>{e.topic && <span className="font-medium text-accent">{e.topic} · </span>}{e.label || '…'}</>}
                      </p>
                    )}
                    {e.modifiedAt && e.modifiedAt !== e.createdAt && (
                      <p className="text-2xs text-ink-faint">{t('timeline.modified')} {new Date(e.modifiedAt).toLocaleString(dateLocale)}</p>
                    )}
                  </div>
                  <button
                    className="shrink-0 text-2xs font-mono text-accent bg-accent/10 hover:bg-accent/20 rounded-full px-1.5 py-0.5 transition-colors opacity-0 group-hover:opacity-100"
                    onClick={() => { close(); onLocate(e.id); }}
                    title={t('hlov.locateTitle')}
                  >
                    {t('tlov.locate')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  ), document.body);
}
