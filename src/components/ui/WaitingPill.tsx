import { MessageCircleQuestion } from 'lucide-react';
import { useT, fmt } from '../../i18n';
import { useStore } from '../../store';
import { flyToWaiting, waitingNodeIds } from '../../lib/agents/waiting';

// On the toolbar while any agent on this canvas waits on the person: how
// many, and one click to the first of them. The card itself stays on its
// node; this is the way back to it from wherever the view is.
export default function WaitingPill() {
  const t = useT();
  const ids = useStore((s) => waitingNodeIds(s.nodes).join(','));
  if (!ids) return null;
  const list = ids.split(',');
  return (
    <button
      onClick={(e) => { e.stopPropagation(); flyToWaiting(list[0]); }}
      className="bg-amber-50 dark:bg-amber-500/15 border border-amber-400/70 rounded-lg h-8 px-2.5 flex items-center gap-1.5 shadow-sm hover:bg-amber-100 dark:hover:bg-amber-500/25 transition-colors text-xs text-amber-800 dark:text-amber-300 animate-fade-in"
      title={t('approval.waitingPillTitle')}
      data-waiting-pill={list.length}
    >
      <MessageCircleQuestion size={14} strokeWidth={1.75} className="shrink-0" />
      <span className="whitespace-nowrap">{fmt(t('approval.waitingPill'), { n: list.length })}</span>
    </button>
  );
}
