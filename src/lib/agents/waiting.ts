import { useStore } from '../../store';
import { useUiStore } from '../ui-store';
import { t } from '../../i18n';
import type { ApprovalRequest } from '../../types';

// An agent waiting on the person must be findable from anywhere: the node
// with the open question opens in the panel (where the card has room), and
// when the window is in the background a system notification says so —
// only where notifications are already allowed (the desktop shell, a host
// app); a page never prompts for the permission.

/** Bring the node with an open question into view and open it in the panel. */
export function flyToWaiting(nodeId: string): void {
  if (!useStore.getState().nodes.some((n) => n.id === nodeId)) return;
  useStore.getState().setSelectedNodeId(nodeId);
  useUiStore.getState().setPanelOpen(true);
  useUiStore.getState().setArrivalFocusNodeId(nodeId);
}

/** The ids of nodes whose running turn waits on an unanswered question, in canvas order. */
export function waitingNodeIds(nodes: ReturnType<typeof useStore.getState>['nodes']): string[] {
  return nodes.filter((n) => n.data.isLoading && (n.data.pendingApprovals ?? []).some((p) => !p.answered)).map((n) => n.id);
}

/** A system notification for a question that arrives while the window is in the background. */
export function notifyWaiting(request: Omit<ApprovalRequest, 'askedAt'>, nodeId: string): void {
  try {
    if (!document.hidden && document.hasFocus()) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const asking = (request.kind ?? 'confirm') !== 'confirm';
    const body = request.kind === 'form' ? (request.questions?.[0]?.question ?? '') : [request.name, request.query].filter(Boolean).join(' · ');
    const n = new Notification(t(asking ? 'approval.askTitle' : 'approval.title'), { body: body.slice(0, 180), tag: request.id });
    n.onclick = () => { window.focus(); flyToWaiting(nodeId); n.close(); };
  } catch { /* notifications unavailable here */ }
}
