import { useEffect } from 'react';
import { Star } from 'lucide-react';
import { useI18n, useT } from '../../i18n';
import { useUiStore } from '../../lib/ui-store';
import { WHATS_NEW } from '../../whats-new';
import { appVersion } from '../../lib/app-version';
import { REPO_URL } from '../../lib/github-stars';
import { WhatsNewItems } from './WhatsNewDialog';

// The release history behind the ⋯ menu: every entry of the what's-new
// list, newest first, the running version marked. Same card as the update
// dialog, so a release reads the same whether it popped up or was looked up.
// Works in the web build too; only the "current" mark needs the shell's
// version.

export default function ReleaseNotesDialog() {
  const open = useUiStore((s) => s.releaseNotesOpen);
  const setOpen = useUiStore((s) => s.setReleaseNotesOpen);
  const lang = useI18n((s) => s.lang);
  const t = useT();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/25 flex items-center justify-center animate-fade-in p-6" onClick={() => setOpen(false)}>
      <div
        className="bg-card border border-line rounded-2xl shadow-xl w-[680px] max-w-full max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="release-notes-title"
        data-release-notes
      >
        <div className="px-6 pt-5 pb-4 border-b border-line">
          <div className="text-2xs uppercase tracking-wide text-ink-faint">ThoughtDAG</div>
          <h2 id="release-notes-title" className="text-base font-semibold text-ink mt-0.5">{t('releaseNotes.title')}</h2>
        </div>
        <ol className="px-6 divide-y divide-line">
          {WHATS_NEW.map((entry) => {
            const current = appVersion === entry.version;
            return (
              <li key={entry.version} className="py-4" data-release={entry.version}>
                <div className="flex items-baseline gap-2.5 flex-wrap">
                  <span className="text-sm font-semibold text-ink tabular-nums">v{entry.version}</span>
                  <span className="text-xs text-ink-faint tabular-nums">{entry.date}</span>
                  {current && (
                    <span className="text-2xs font-medium uppercase tracking-wide text-accent bg-accent/10 rounded-full px-2 py-0.5">{t('releaseNotes.current')}</span>
                  )}
                </div>
                <p className="text-sm text-ink-muted leading-relaxed mt-1.5 [overflow-wrap:anywhere]">{entry.lead[lang]}</p>
                <WhatsNewItems items={entry.items} lang={lang} />
              </li>
            );
          })}
        </ol>
        <div className="sticky bottom-0 bg-card px-6 py-4 border-t border-line flex items-center justify-between gap-4">
          {/* the history's two doors back to the repository: the full notes, and the star */}
          <div className="flex items-center gap-4 text-xs min-w-0 flex-wrap">
            <a href={`${REPO_URL}/releases`} target="_blank" rel="noreferrer" className="text-ink-muted hover:text-ink hover:underline" data-release-notes-github>{t('releaseNotes.onGithub')}</a>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline whitespace-nowrap" data-release-notes-star>{t('whatsNew.starLink')} <Star size={12} strokeWidth={1.75} className="fill-current" /> →</a>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="text-xs text-ink px-4 py-2 rounded-lg border border-line hover:bg-wash transition-colors"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
