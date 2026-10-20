import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Check, ChevronDown } from 'lucide-react';
import { useT } from '../../i18n';
import { useUiStore } from '../../lib/ui-store';
import { useProjects, setProjectAgentCwd } from '../../store/projects';
import { useStore } from '../../store';
import { isAgentModel, resolveAgentCwd, mirroredCwd, type CwdChoice } from '../../lib/agents/agent-runtime';
import { isHarnessAgentModel } from '../../lib/atlas/dsh-bridge';
import { IN_HARNESS } from '../../lib/embedded';

// Where the agent works, on the toolbar, whenever an agent model is the
// pick: the chosen folder, the mirrored project, or the canvas's own
// workspace. One click shows the choices; the folder dialog adds a new one.
// Nothing is mandatory — the default stays the workspace.

const tail = (p: string) => p.split('/').filter(Boolean).slice(-1)[0] ?? p;

export default function AgentCwdChip() {
  const t = useT();
  const selectedModel = useUiStore((s) => s.selectedModel);
  const activeId = useProjects((s) => s.activeId);
  const projects = useProjects((s) => s.projects);
  const nodeCount = useStore((s) => s.nodes.length);
  const [choice, setChoice] = useState<CwdChoice | null>(null);
  const [mirrored, setMirrored] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [, rerender] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  // the runtimes the canvas launches itself, and inside the harness its own
  // agent too: a fresh harness session runs where this says
  const harness = IN_HARNESS && !!window.desktopSessions && isHarnessAgentModel(selectedModel);
  const visible = !!window.desktopAgents && (isAgentModel(selectedModel) || harness);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    void resolveAgentCwd(harness).then((c) => { if (alive) setChoice(c); });
    void mirroredCwd().then((m) => { if (alive) setMirrored(m); });
    return () => { alive = false; };
  }, [visible, harness, activeId, projects, nodeCount]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!visible || !choice) return null;
  const meta = projects.find((p) => p.id === activeId);
  const recent = [...new Set(projects.map((p) => p.agentCwd).filter((c): c is string => !!c))].filter((c) => c !== meta?.agentCwd).slice(0, 5);

  const choose = async (cwd: string | undefined) => {
    if (!activeId) return;
    await setProjectAgentCwd(activeId, cwd);
    setOpen(false);
  };
  const nativePicker = window.desktopAgents?.capabilities?.nativePicker !== false;
  const pick = async () => {
    const dir = await window.desktopAgents!.pickCwd();
    if (dir) await choose(dir);
    // the host found it has no dialog after all (capabilities flipped): show the typed field now
    else if (window.desktopAgents?.capabilities?.nativePicker === false) rerender((n) => n + 1);
  };
  const submitTyped = async () => {
    const v = typed.trim();
    if (v.startsWith('/')) await choose(v);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="bg-card/90 backdrop-blur border border-line rounded-lg h-8 px-2.5 flex items-center gap-1.5 shadow-sm hover:bg-wash transition-colors text-xs text-ink max-w-[220px]"
        title={`${t('agent.cwd')} · ${choice.cwd}`}
        data-agent-cwd={choice.kind}
      >
        <FolderOpen size={14} strokeWidth={1.75} className="text-ink-faint shrink-0" />
        <span className="truncate">{choice.kind === 'workspace' ? t('agent.cwdWorkspace') : tail(choice.cwd)}</span>
        <ChevronDown size={12} strokeWidth={1.75} className="text-ink-faint shrink-0" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-[320px] bg-card border border-line rounded-xl shadow-lg py-1.5 z-50 animate-fade-in" onClick={(e) => e.stopPropagation()}>
          <p className="text-2xs text-ink-faint uppercase tracking-wider font-medium px-3 pt-1 pb-1">{t('agent.cwd')}</p>
          <button onClick={() => void choose(undefined)} className="w-full text-left px-3 py-2 text-xs hover:bg-wash flex items-center gap-2">
            <span className="flex-1 min-w-0">
              <span className="block text-ink">{mirrored ? t('agent.cwdMirrored') : choice.kind === 'session' ? t('agent.cwdSession') : t('agent.cwdWorkspace')}</span>
              <span className="block text-2xs text-ink-faint truncate">{mirrored ?? (choice.kind === 'session' ? choice.cwd : t('agent.cwdWorkspaceHint'))}</span>
            </span>
            {!meta?.agentCwd && <Check size={13} strokeWidth={2} className="shrink-0 text-accent" />}
          </button>
          {meta?.agentCwd && (
            <button onClick={() => void choose(meta.agentCwd)} className="w-full text-left px-3 py-2 text-xs hover:bg-wash flex items-center gap-2">
              <span className="flex-1 min-w-0"><span className="block text-ink">{tail(meta.agentCwd)}</span><span className="block text-2xs text-ink-faint truncate">{meta.agentCwd}</span></span>
              <Check size={13} strokeWidth={2} className="shrink-0 text-accent" />
            </button>
          )}
          {recent.length > 0 && <p className="text-2xs text-ink-faint uppercase tracking-wider font-medium px-3 pt-2 pb-1">{t('agent.cwdRecent')}</p>}
          {recent.map((c) => (
            <button key={c} onClick={() => void choose(c)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-wash flex items-center gap-2">
              <span className="flex-1 min-w-0"><span className="block text-ink">{tail(c)}</span><span className="block text-2xs text-ink-faint truncate">{c}</span></span>
            </button>
          ))}
          <div className="border-t border-line/60 my-1" />
          {nativePicker ? (
            <button onClick={() => void pick()} className="w-full text-left px-3 py-2 text-xs text-ink hover:bg-wash flex items-center gap-2" data-agent-cwd-pick>
              <FolderOpen size={14} strokeWidth={1.75} className="text-ink-faint shrink-0" /> {t('agent.cwdPick')}
            </button>
          ) : (
            <div className="px-3 py-2 flex items-center gap-2">
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') void submitTyped(); }}
                placeholder={t('agent.cwdType')}
                className="flex-1 min-w-0 text-xs font-mono bg-wash border border-line rounded-md px-2 py-1 focus:outline-none focus:border-accent/60"
                data-agent-cwd-input
              />
              <button onClick={() => void submitTyped()} className="text-xs text-accent hover:underline shrink-0">{t('agent.cwdUse')}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
