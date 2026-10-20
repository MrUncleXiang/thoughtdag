import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ShieldCheck, ShieldEllipsis, ShieldOff, X } from 'lucide-react';
import { useT, type MessageKey as TKey } from '../../i18n';
import { useUiStore } from '../../lib/ui-store';
import { useProjects } from '../../store/projects';
import { isAgentModel, runtimeOf, setGuardMode, allowLocation } from '../../lib/agents/agent-runtime';
import { isHarnessAgentModel } from '../../lib/atlas/dsh-bridge';
import { IN_HARNESS } from '../../lib/embedded';
import { API_BASE } from '../../lib/constants';
import type { AgentPermissionMode } from '../../types';

// How freely the agents this canvas starts may act, on the toolbar beside
// the working directory: ask before risky steps, let the runtime's own
// review decide, or ask nothing. One switch per canvas; each runtime maps it
// onto its own modes, so the menu says what each choice means for the agent
// that is picked. Questions the agent puts to the person are not affected:
// they always reach the node.

type Lane = 'claude-code' | 'codex' | 'pi' | 'harness';

const ASK_HINT: Record<Lane, TKey> = {
  'claude-code': 'agent.permAskClaude', codex: 'agent.permAskCodex', pi: 'agent.permAskPi', harness: 'agent.permAskHarness',
};
const AUTO_HINT: Record<Lane, TKey> = {
  'claude-code': 'agent.permAutoClaude', codex: 'agent.permAutoCodex', pi: 'agent.permAutoNone', harness: 'agent.permAutoHarness',
};
const ICON = { ask: ShieldCheck, auto: ShieldEllipsis, allow: ShieldOff } as const;
const LABEL: Record<AgentPermissionMode, TKey> = { ask: 'agent.permAsk', auto: 'agent.permAuto', allow: 'agent.permAllow' };

export default function AgentPermissionChip() {
  const t = useT();
  const selectedModel = useUiStore((s) => s.selectedModel);
  const activeId = useProjects((s) => s.activeId);
  const guard = useProjects((s) => s.projects.find((p) => p.id === s.activeId)?.agentGuard);
  const [open, setOpen] = useState(false);
  // inside the harness: whether its Auto review is installed (null = not asked yet)
  const [hostAuto, setHostAuto] = useState<boolean | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const harness = IN_HARNESS && !!window.desktopSessions && isHarnessAgentModel(selectedModel);
  const visible = !!window.desktopAgents && (isAgentModel(selectedModel) || harness);
  const lane: Lane = harness ? 'harness' : (runtimeOf(selectedModel) ?? 'pi');

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  useEffect(() => {
    if (!open || lane !== 'harness') return;
    let alive = true;
    void fetch(`${API_BASE}/api/permission-modes`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive) setHostAuto(!!j?.auto); }).catch(() => { if (alive) setHostAuto(false); });
    return () => { alive = false; };
  }, [open, lane]);

  if (!visible || !activeId) return null;
  const mode: AgentPermissionMode = guard?.mode ?? 'ask';
  const autoOff = lane === 'pi' || (lane === 'harness' && hostAuto === false);
  // a saved 'auto' on an agent without a review of its own runs as 'ask'
  const shown: AgentPermissionMode = mode === 'auto' && lane === 'pi' ? 'ask' : mode;
  const Icon = ICON[shown];
  const choose = async (m: AgentPermissionMode) => { await setGuardMode(m); setOpen(false); };
  const allowed = guard?.allow ?? [];

  const row = (m: AgentPermissionMode, hint: TKey, disabled = false) => {
    const RowIcon = ICON[m];
    return (
      <button
        onClick={() => { if (!disabled) void choose(m); }}
        disabled={disabled}
        className="w-full text-left px-3 py-1.5 text-xs hover:bg-wash disabled:hover:bg-transparent disabled:opacity-50 flex items-start gap-2"
        data-agent-permission={m}
      >
        <RowIcon size={14} strokeWidth={1.75} className={`shrink-0 mt-0.5 ${m === 'allow' ? 'text-amber-600 dark:text-amber-400' : 'text-ink-faint'}`} />
        <span className="flex-1 min-w-0"><span className="block text-ink">{t(LABEL[m])}</span><span className="block text-2xs text-ink-faint leading-relaxed">{t(hint)}</span></span>
        {mode === m && <Check size={13} strokeWidth={2} className="shrink-0 mt-0.5 text-accent" />}
      </button>
    );
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`bg-card/90 backdrop-blur border rounded-lg h-8 px-2.5 flex items-center gap-1.5 shadow-sm hover:bg-wash transition-colors text-xs ${shown === 'allow' ? 'border-amber-400/70 text-amber-700 dark:text-amber-300' : 'border-line text-ink'}`}
        title={`${t('agent.perm')} · ${t(LABEL[shown])}`}
        data-agent-permission-chip={shown}
      >
        <Icon size={14} strokeWidth={1.75} className={`shrink-0 ${shown === 'allow' ? '' : 'text-ink-faint'}`} />
        <span className="whitespace-nowrap">{t(LABEL[shown])}</span>
        <ChevronDown size={12} strokeWidth={1.75} className="text-ink-faint shrink-0" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-[320px] bg-card border border-line rounded-xl shadow-lg py-1.5 z-50 animate-fade-in" onClick={(e) => e.stopPropagation()} data-agent-permission-menu>
          <p className="text-2xs text-ink-faint uppercase tracking-wider font-medium px-3 pt-1 pb-1">{t('agent.perm')} · {t('agent.permScope')}</p>
          {row('ask', ASK_HINT[lane])}
          {row('auto', lane === 'harness' && hostAuto === false ? 'agent.permAutoHarnessOff' : AUTO_HINT[lane], autoOff)}
          {row('allow', lane === 'harness' ? 'agent.permAllowHarness' : 'agent.permAllowHint')}
          {lane === 'pi' && allowed.length > 0 && (
            <>
              <div className="border-t border-line/60 my-1" />
              <p className="text-2xs text-ink-faint px-3 pt-1 pb-1">{t('agent.guardAllowed')}</p>
              {allowed.map((a) => (
                <div key={a} className="px-3 py-1 text-xs flex items-center gap-2 min-w-0" data-agent-guard-allowed={a}>
                  <span className="flex-1 min-w-0 truncate text-ink-muted font-mono" title={a}>{a}</span>
                  <button onClick={() => void allowLocation(a, true)} className="text-ink-faint hover:text-red-500 shrink-0" title={t('agent.guardRemove')}>
                    <X size={12} strokeWidth={2} />
                  </button>
                </div>
              ))}
            </>
          )}
          <div className="border-t border-line/60 my-1" />
          <p className="px-3 py-1 text-2xs text-ink-faint leading-relaxed">{t('agent.permQuestions')}</p>
        </div>
      )}
    </div>
  );
}
