import { useEffect, useRef, useState } from 'react';
import { Archive, Check, ChevronDown, Dna, FolderOpen, Loader2, Map as MapIcon, Minimize2, Pencil, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import SessionAtlas from './SessionAtlas';
import HarnessViewSwitch from './ui/HarnessViewSwitch';
import { knownSessionIds } from '../lib/atlas/discover';
import { useProjects, switchProject, createProject, renameProject, deleteProject, setProjectArchived } from '../store/projects';
import { useI18n } from '../i18n';
import { parseImportFile } from '../lib/export';
import ImportChatModal from './ImportChatModal';
import type { ImportableConversation } from '../lib/import-chat';
import { confirmDialog, toast } from '../lib/ui-store';
import { isImeComposing } from '../utils';
import { useT, t as ti, fmt } from '../i18n';

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return ti('switcher.justNow');
  if (min < 60) return fmt(ti('switcher.minAgo'), { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return fmt(ti('switcher.hourAgo'), { n: h });
  const d = Math.floor(h / 24);
  if (d < 30) return fmt(ti('switcher.dayAgo'), { n: d });
  return new Date(ts).toLocaleDateString(useI18n.getState().lang === 'zh' ? 'zh-CN' : 'en-US');
}

export default function ProjectSwitcher({ onSwitched }: { onSwitched: () => void }) {
  const t = useT();
  const projects = useProjects((s) => s.projects);
  const activeId = useProjects((s) => s.activeId);
  const switching = useProjects((s) => s.switching);
  const activeIsParadigm = projects.find((p) => p.id === activeId)?.kind === 'paradigm';
  const [open, setOpen] = useState(false);
  // Windows and Linux shells: keep running in the tray when the window
  // closes (#77); the tray menu speaks the page's language
  const lang = useI18n((s) => s.lang);
  const [closeToTray, setCloseToTray] = useState<boolean | null>(null);
  useEffect(() => {
    const tray = window.desktop?.tray;
    if (!tray) return;
    let alive = true;
    void tray({ labels: { open: ti('tray.open'), quit: ti('tray.quit') } }).then((r) => { if (alive) setCloseToTray(r.closeToTray); }).catch(() => undefined);
    return () => { alive = false; };
  }, [lang]);
  const [chatImport, setChatImport] = useState<ImportableConversation[] | null>(null);
  const [atlasOpen, setAtlasOpen] = useState(false);
  const [atlasFocus, setAtlasFocus] = useState<string | undefined>(undefined);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const importFileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const active = projects.find((p) => p.id === activeId);
  // the dropdown is a time machine, not a library: recent few only,
  // archived canvases invisible, the atlas owns browsing and management
  const sorted = projects.filter((p) => !p.archived).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 7);

  // tidy vs destroy are different verbs — and the delete confirm is a
  // uniqueness detector: it says exactly what would be lost
  const confirmDelete = async (p: (typeof projects)[number]) => {
    const { canvasUniqueness } = await import('../lib/atlas/canonical');
    const u = await canvasUniqueness(p.id);
    const msgKey = u === 'native' ? 'confirm.deleteNative' : u === 'diverged-mirror' ? 'confirm.deleteDiverged' : 'confirm.deletePristine';
    const ok = await confirmDialog({
      title: ti('confirm.deleteCanvasTitle'),
      message: fmt(ti(msgKey), { name: p.name }),
      confirmLabel: ti('common.delete'),
      danger: u !== 'pristine-mirror',
    });
    if (ok) void deleteProject(p.id).then(onSwitched);
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  const doSwitch = async (id: string) => {
    setOpen(false);
    await switchProject(id);
    onSwitched();
    // arrival reconciliation: heal the ledger, then close the mirror gap
    // (the live watcher only follows the ACTIVE canvas — this one may
    // have missed its sessions' growth while another was open)
    void import('../lib/atlas/canonical').then((m) => m.unsubscribeOrphanedSessions());
    void import('../lib/atlas/live-mirror').then((m) => m.sweepRecentSessions());
  };

  return (
    // z-20: the open dropdown must cover the content palette below (both
    // live on the left edge; the palette is z-10)
    <div ref={rootRef} className="absolute top-4 left-4 z-20">
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setOpen(!open)}
          disabled={switching}
          className="bg-card/90 backdrop-blur border border-line rounded-xl px-3.5 py-2 shadow-sm hover:bg-wash transition-colors flex items-center gap-2 text-sm text-ink max-w-[240px] disabled:opacity-60"
        >
          {switching
            ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin shrink-0 text-accent" />
            : activeIsParadigm
              ? <Dna size={16} strokeWidth={1.75} className="shrink-0 text-accent" />
              : <FolderOpen size={16} strokeWidth={1.75} className="shrink-0 text-ink-muted" />}
          <span className="truncate font-medium">{active?.name ?? '…'}</span>
          <ChevronDown size={14} strokeWidth={1.75} className="shrink-0 text-ink-faint" />
        </button>
        {/* inside the harness: the view switch shares this row (see HarnessViewSwitch) */}
        <HarnessViewSwitch />
        {/* the twin badge: this canvas is one face of a session — the
            other face is one click away on the map */}
        {!!active?.sourceSession?.sessionId && (() => {
          // three states, honest about the source: reachable (live),
          // unreachable on this machine (grey — the ledger holds only
          // UUIDs, so the moment the source appears anywhere in a
          // scanned root, listening resumes on its own), or no scan yet
          // (assume live: never a false alarm)
          const unreachable = knownSessionIds.size > 0 && !knownSessionIds.has(active.sourceSession.sessionId);
          return (
            <button
              title={unreachable
                ? ti('switcher.mirrorBadgeGone')
                : fmt(ti('switcher.mirrorBadge'), { runner: active.sourceSession!.runner })}
              onClick={() => { setAtlasFocus(active.sourceSession!.sessionId); setAtlasOpen(true); }}
              className={`bg-card/90 backdrop-blur border border-line rounded-xl px-2 py-2 shadow-sm hover:bg-wash transition-colors text-2xs font-mono flex items-center gap-1 ${unreachable ? 'text-ink-faint/50 line-through decoration-1' : 'text-ink-faint hover:text-accent'}`}
              data-twin-badge={unreachable ? 'unreachable' : 'live'}
            >
              ⇄ {active.sourceSession!.runner}
            </button>
          );
        })()}
      </div>

      {open && (
        <div className="mt-1.5 bg-card border border-line rounded-xl shadow-lg py-1.5 w-[320px] animate-fade-in">
          <div className="max-h-[320px] overflow-y-auto">
            {sorted.map((p) => (
              <div
                key={p.id}
                className={`group flex items-center gap-1 px-3 py-2 hover:bg-wash cursor-pointer transition-colors ${p.id === activeId ? 'bg-accent/5' : ''}`}
                onClick={() => { if (renamingId !== p.id && p.id !== activeId) void doSwitch(p.id); }}
              >
                {renamingId === p.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isImeComposing(e) && renameValue.trim()) {
                        void renameProject(p.id, renameValue.trim());
                        setRenamingId(null);
                      }
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    onBlur={() => setRenamingId(null)}
                    className="flex-1 text-sm text-ink border border-accent/40 rounded-lg px-2 py-1 bg-surface focus:outline-none"
                  />
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      {/* the name owns its line; provenance rides below with the time */}
                      <div className={`text-sm truncate ${p.id === activeId ? 'text-accent font-medium' : 'text-ink'}`}>
                        {p.name}
                      </div>
                      <div className="text-2xs text-ink-faint flex items-center gap-1.5">
                        <span>{relativeTime(p.updatedAt)}</span>
                        {!!p.sourceSession?.sessionId && (
                          <span className="font-mono border border-line rounded px-1 py-px" data-mirror-mark>
                            {p.sourceSession.runner}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      title={t('switcher.rename')}
                      className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-ink p-1 rounded transition-all shrink-0"
                      onClick={(e) => { e.stopPropagation(); setRenamingId(p.id); setRenameValue(p.name); }}
                    >
                      <Pencil size={14} strokeWidth={1.75} />
                    </button>
                    <button
                      title={t('common.delete')}
                      className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-red-500 p-1 rounded transition-all shrink-0"
                      onClick={(e) => { e.stopPropagation(); void confirmDelete(p); }}
                    >
                      <Trash2 size={14} strokeWidth={1.75} />
                    </button>
                    <button
                      title={t('switcher.archive')}
                      className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-amber-600 p-1 rounded transition-all shrink-0"
                      onClick={(e) => { e.stopPropagation(); void setProjectArchived(p.id, true).then(onSwitched); }}
                      data-archive-canvas
                    >
                      <Archive size={14} strokeWidth={1.75} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-line mt-1 pt-1">
            <button
              onClick={() => { setOpen(false); void createProject().then(onSwitched); }}
              className="w-full text-left px-3 py-2 text-sm text-accent hover:bg-wash transition-colors flex items-center gap-2"
            >
              <Plus size={15} strokeWidth={1.75} /> {t('switcher.newCanvas')}
            </button>
            <button
              onClick={() => importFileRef.current?.click()}
              className="w-full text-left px-3 py-2 text-sm text-ink-muted hover:bg-wash transition-colors flex items-center gap-2"
            >
              <Upload size={15} strokeWidth={1.75} /> {t('switcher.importBackup')}
            </button>
            <button
              onClick={() => { setOpen(false); setAtlasOpen(true); }}
              className="w-full text-left px-3 py-2 text-sm text-ink-muted hover:bg-wash transition-colors flex items-center gap-2"
              data-open-atlas
            >
              <MapIcon size={15} strokeWidth={1.75} /> {t('switcher.allCanvases')}
            </button>
            {window.desktop && (
              <button
                onClick={() => { setOpen(false); void window.desktop!.checkForUpdates(); }}
                className="w-full text-left px-3 py-2 text-sm text-ink-muted hover:bg-wash transition-colors flex items-center gap-2"
                data-check-updates
              >
                <RefreshCw size={15} strokeWidth={1.75} /> {t('update.checkMenu')}
                {/* the one place that answers "which version am I on" at a glance */}
                <span className="ml-auto text-2xs text-ink-faint">
                  v{new URLSearchParams(window.location.search).get('dv')}
                </span>
              </button>
            )}
            {window.desktop?.tray && closeToTray !== null && (
              <button
                onClick={() => {
                  const on = !closeToTray;
                  setCloseToTray(on);
                  void window.desktop!.tray!({ on }).then((r) => setCloseToTray(r.closeToTray)).catch(() => setCloseToTray(!on));
                }}
                className="w-full text-left px-3 py-2 text-sm text-ink-muted hover:bg-wash transition-colors flex items-center gap-2"
                title={t('switcher.closeToTrayHint')}
                data-close-to-tray={closeToTray ? 'on' : 'off'}
              >
                <Minimize2 size={15} strokeWidth={1.75} /> {t('switcher.closeToTray')}
                {closeToTray && <Check size={14} strokeWidth={2} className="ml-auto text-accent" />}
              </button>
            )}
            <input
              ref={importFileRef}
              type="file"
              accept=".json,.jsonl,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  // Every failure path must surface — a silently swallowed
                  // rejection here reads as "the import does nothing".
                  void parseImportFile(f).then((r) => {
                    if (r.kind === 'own' && r.ok) { setOpen(false); onSwitched(); }
                    else if (r.kind === 'chat') { setOpen(false); setChatImport(r.conversations); }
                  }).catch((err) => {
                    toast('error', fmt(ti('toast.importFailedGeneric'), { msg: err instanceof Error ? err.message : String(err) }));
                  });
                }
                e.target.value = '';
              }}
            />
          </div>
        </div>
      )}
      {chatImport && (
        <ImportChatModal
          conversations={chatImport}
          onClose={() => setChatImport(null)}
          onDone={() => { setChatImport(null); onSwitched(); }}
        />
      )}
      {atlasOpen && <SessionAtlas onClose={() => { setAtlasOpen(false); setAtlasFocus(undefined); }} onSwitched={onSwitched} focusSessionId={atlasFocus} />}
    </div>
  );
}
