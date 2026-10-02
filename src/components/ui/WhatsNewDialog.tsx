import { useEffect, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { useI18n, useT, fmt } from '../../i18n';
import { useUiStore } from '../../lib/ui-store';
import { appVersion } from '../../lib/app-version';
import { REPO_URL } from '../../lib/github-stars';
import { announcedSince, type WhatsNewEntry, type WhatsNewItem, type WhatsNewMedia } from '../../whats-new';
import type { Lang } from '../../i18n';

// On the first launch after an update: what changed since the version this
// person last read about, newest release first, each with a door to read
// more. Releases that were skipped, or whose notes never got shown, come
// along — so the dialog is "since your last look", not "this version only".
// The desktop shell hands its version over in the URL (?dv=); the web build
// has no version of its own and never shows this. A fresh install is not an
// update: the current version is recorded silently and nothing pops.
// `?wn=1` forces the dialog with every announced release up to the running
// version (development, demos; the shell adds it for TD_WHATS_NEW=1).

const SEEN_KEY = 'thoughtdag.whatsNewSeen';
const params = new URLSearchParams(window.location.search);

function decide(): WhatsNewEntry[] {
  if (!appVersion) return [];
  const forced = params.get('wn');
  if (forced === '1') return announcedSince(null, appVersion);
  if (forced) return announcedSince(forced, appVersion); // ?wn=<version>: preview the dialog as someone upgrading from that version
  let seen: string | null = null;
  try { seen = localStorage.getItem(SEEN_KEY); } catch { /* storage unavailable: never nag */ }
  if (seen === null) {
    // no record: either a fresh install, or an install that predates this
    // dialog (0.4.5 is its first release). Marks an earlier version leaves —
    // a finished tutorial, a backup — tell the two apart: with any of them
    // this is an upgrade and every announced release shows; without, the
    // version is recorded silently and nothing pops on a first launch.
    let prior = false;
    try { prior = !!(localStorage.getItem('thoughtdag.tutorialDone') || localStorage.getItem('thoughtdag.lastBackupAt')); } catch { /* ignore */ }
    if (!prior) { try { localStorage.setItem(SEEN_KEY, appVersion); } catch { /* ignore */ } return []; }
    return announcedSince(null, appVersion);
  }
  if (seen === appVersion) return [];
  return announcedSince(seen, appVersion);
}

/** A bundled clip or picture: a clip plays muted in a loop, a still shows as is; the box keeps its ratio while loading. */
export function WhatsNewMediaView({ media, lang }: { media: WhatsNewMedia; lang: Lang }) {
  const src = media.src[lang];
  const isClip = /\.(mp4|webm)$/i.test(src);
  return (
    <div className="mt-3 rounded-xl border border-line overflow-hidden bg-wash" style={{ aspectRatio: `${media.width} / ${media.height}` }} data-whats-new-media>
      {isClip
        ? <video src={`${import.meta.env.BASE_URL}${src}`} autoPlay loop muted playsInline className="w-full h-full object-cover" aria-label={media.alt[lang]} />
        : <img src={`${import.meta.env.BASE_URL}${src}`} alt={media.alt[lang]} className="w-full h-full object-cover" />}
    </div>
  );
}

/** The numbered items of one release; shared with the release history. */
export function WhatsNewItems({ items, lang }: { items: WhatsNewItem[]; lang: Lang }) {
  if (items.length === 0) return null;
  return (
    <ol className="divide-y divide-line">
      {items.map((it, i) => (
        <li key={i} className="py-3 flex gap-3.5">
          <span className="shrink-0 w-6 h-6 rounded-full bg-accent/10 text-accent text-xs font-semibold flex items-center justify-center mt-0.5">{i + 1}</span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink">{it.title[lang]}</div>
            <p className="text-sm text-ink-muted leading-relaxed mt-1 [overflow-wrap:anywhere]">{it.body[lang]}</p>
            {it.media && <WhatsNewMediaView media={it.media} lang={lang} />}
            {it.link && (
              <a
                href={it.link.href}
                target="_blank"
                rel="noreferrer"
                className="inline-block mt-1.5 text-xs font-medium text-accent hover:underline"
              >
                {it.link.label[lang]} →
              </a>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function WhatsNewDialog() {
  const [entries, setEntries] = useState<WhatsNewEntry[]>(() => decide());
  const open = entries.length > 0;
  const lang = useI18n((s) => s.lang);
  const t = useT();
  const okRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    if (appVersion) { try { localStorage.setItem(SEEN_KEY, appVersion); } catch { /* ignore */ } }
    setEntries([]);
  };

  useEffect(() => {
    if (!open) return;
    // Enter closes, so the button holds focus — taken without scrolling, or
    // the panel would open scrolled to its foot and hide the title
    okRef.current?.focus({ preventScroll: true });
    const onKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape' || e.key === 'Enter') close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/25 flex items-center justify-center animate-fade-in p-6" onClick={close}>
      <div
        className="bg-card border border-line rounded-2xl shadow-xl w-[680px] max-w-full max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="whats-new-title"
        data-whats-new
      >
        <div className="px-6 pt-5 pb-4 border-b border-line">
          <div className="text-2xs uppercase tracking-wide text-ink-faint">ThoughtDAG</div>
          <h2 id="whats-new-title" className="text-base font-semibold text-ink mt-0.5">{fmt(t('whatsNew.title'), { v: appVersion ?? '' })}</h2>
          {entries.length > 1 && <p className="text-xs text-ink-faint mt-1">{t('whatsNew.multi')}</p>}
        </div>
        <ol className="px-6 divide-y divide-line">
          {entries.map((entry) => (
            <li key={entry.version} className="py-4" data-release={entry.version}>
              {entries.length > 1 && (
                <div className="flex items-baseline gap-2.5 mb-1.5">
                  <span className="text-sm font-semibold text-ink tabular-nums">v{entry.version}</span>
                  <span className="text-xs text-ink-faint tabular-nums">{entry.date}</span>
                </div>
              )}
              <p className="text-sm text-ink-muted leading-relaxed [overflow-wrap:anywhere]">{entry.lead[lang]}</p>
              {entry.media && <WhatsNewMediaView media={entry.media} lang={lang} />}
              <WhatsNewItems items={entry.items} lang={lang} />
            </li>
          ))}
        </ol>
        <div className="sticky bottom-0 bg-card px-6 py-4 border-t border-line flex items-center justify-between gap-4">
          <div className="min-w-0 text-xs text-ink-muted">
            {/* the one ask, at the one moment it fits: a person who just read what the update brought */}
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline whitespace-nowrap" data-whats-new-star>
              {t('whatsNew.starLink')} <Star size={12} strokeWidth={1.75} className="fill-current" /> →
            </a>
            <button
              onClick={() => { close(); useUiStore.getState().setReleaseNotesOpen(true); }}
              className="mt-1 text-ink-faint hover:text-ink hover:underline transition-colors"
              data-whats-new-all
            >
              {t('whatsNew.seeAll')}
            </button>
          </div>
          <button
            ref={okRef}
            onClick={close}
            className="text-xs text-white px-4 py-2 rounded-lg bg-accent hover:bg-accent-strong transition-colors"
          >
            {t('whatsNew.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
