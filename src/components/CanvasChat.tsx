import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Loader2, MessageCircleQuestion, Send, X } from 'lucide-react';
import { useStore } from '../store';
import { useUiStore, toast } from '../lib/ui-store';
import { useProjects } from '../store/projects';
import { useI18n, useT, fmt } from '../i18n';
import { isImeComposing, generateId } from '../utils';
import { askCanvas, aliasNodes, answerForCanvas, nodeLabel, type CanvasChatTurn } from '../lib/canvas-chat';
import { makeNode } from '../lib/import-chat';
import { Markdown } from './Markdown';
import { COLORS } from '../lib/constants';
import type { ThoughtEdge } from '../types';

// The "ask the canvas" dialog, bottom right: the model reads the canvas's
// outline (and the selected node's chain) and answers with [[numbers]];
// each number is a chip that locates the node, a number the canvas does not
// have is red. Turns are kept per canvas in this browser. An answer joins
// the graph only through "drop onto the canvas": a node under the focused
// node (or free-standing), wired by reference to every node it cited.

const KEY = (projectId: string) => `thoughtdag.canvasChat.${projectId}`;
const CAP = 40;
const loadTurns = (projectId: string): CanvasChatTurn[] => { try { const v = JSON.parse(localStorage.getItem(KEY(projectId)) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const saveTurns = (projectId: string, turns: CanvasChatTurn[]) => { try { localStorage.setItem(KEY(projectId), JSON.stringify(turns.slice(-CAP))); } catch { /* the dialog still works for this page */ } };

export default function CanvasChat({ open, onClose, onLocate }: { open: boolean; onClose: () => void; onLocate: (id: string) => void }) {
  const t = useT();
  const lang = useI18n((s) => s.lang);
  const projectId = useProjects((s) => s.activeId) ?? 'default';
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const selectedModel = useUiStore((s) => s.selectedModel);
  const [turns, setTurns] = useState<CanvasChatTurn[]>(() => loadTurns(projectId));
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [focusCleared, setFocusCleared] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { setTurns(loadTurns(projectId)); }, [projectId]);
  const firstProject = useRef(projectId);
  useEffect(() => { if (projectId !== firstProject.current) { firstProject.current = projectId; if (open) onClose(); } }, [projectId, open, onClose]);
  useEffect(() => { if (open) list.current?.scrollTo({ top: list.current.scrollHeight }); }, [open, turns.length, busy]);
  // a beacon left on by a hover must not outlive the dialog
  useEffect(() => { if (!open) useUiStore.getState().setBeaconNodeId(null); }, [open]);
  // the selection is the focus unless the person set it aside for this question
  useEffect(() => { setFocusCleared(false); }, [selectedNodeId]);
  const focusId = !focusCleared && selectedNodeId && nodes.some((n) => n.id === selectedNodeId && !n.data.archived) ? selectedNodeId : null;
  const focusNode = focusId ? nodes.find((n) => n.id === focusId) : undefined;
  // numbers are per request; the map of the latest state resolves older turns too (the order is canvas order)
  const { byAlias, byId } = useMemo(() => aliasNodes(nodes), [nodes]);

  const send = async () => {
    const q = draft.trim();
    if (!q || busy) return;
    // the question belongs to the canvas it is asked on: the answer is stored and shown there and nowhere else,
    // even when the person has switched canvases by the time it arrives (#59)
    const origin = projectId;
    const user: CanvasChatTurn = { id: generateId(), role: 'user', text: q, at: new Date().toISOString(), focus: focusId, project: origin };
    const next = [...turns, user];
    setTurns(next); saveTurns(origin, next); setDraft(''); setBusy(true);
    try {
      const { turn } = await askCanvas(nodes, edges, focusId, q, turns, lang, selectedModel ?? undefined);
      turn.project = origin;
      if ((useProjects.getState().activeId ?? 'default') === origin) {
        const done = [...next, turn];
        setTurns(done); saveTurns(origin, done);
      } else {
        saveTurns(origin, [...loadTurns(origin), turn]);
      }
    } finally { setBusy(false); }
  };

  // the map a turn's numbers were made with: its own, kept on the turn; the current one for turns from before 0.5.16
  const mapOf = (turn: CanvasChatTurn): Map<string, string> => (turn.aliases ? new Map(Object.entries(turn.aliases)) : byAlias);
  const drop = (turn: CanvasChatTurn, question: string) => {
    if (turn.project && turn.project !== projectId) return;
    const st = useStore.getState();
    const cited = (turn.cites ?? []).filter((id) => st.nodes.some((n) => n.id === id));
    const anchor = (turn.focus && st.nodes.find((n) => n.id === turn.focus)) || (cited.length ? st.nodes.find((n) => n.id === cited[cited.length - 1]) : undefined);
    const below = anchor ? st.nodes.filter((n) => Math.abs(n.position.x - anchor.position.x) < 400 && n.position.y > anchor.position.y) : [];
    const position = anchor
      ? { x: anchor.position.x + (turn.focus ? 0 : 560), y: turn.focus ? Math.max(anchor.position.y + 420, ...below.map((n) => n.position.y + 420)) : anchor.position.y }
      : { x: Math.max(0, ...st.nodes.map((n) => n.position.x + 560)), y: 0 };
    const node = makeNode(question, answerForCanvas(turn.text, mapOf(turn), st.nodes, lang), !turn.focus);
    node.position = position;
    node.data = { ...node.data, isCollapsed: false, createdAt: turn.at, lastGeneratedAt: turn.at, generatedBy: [turn.model ?? null], isBranch: !!turn.focus };
    st.pushHistory();
    const newEdges: ThoughtEdge[] = [];
    if (turn.focus && st.nodes.some((n) => n.id === turn.focus)) {
      newEdges.push({ id: `edge-${turn.focus}-${node.id}`, source: turn.focus, target: node.id, type: 'smoothstep', sourceHandle: 'continue', targetHandle: 'top', style: { stroke: COLORS.accent, strokeWidth: 2 }, markerEnd: { type: 'arrowclosed', color: COLORS.accent, width: 18, height: 18 } as ThoughtEdge['markerEnd'], data: {} });
    }
    // the citations as quote-depth references, the shape addCrossLink draws, wired in one go: that action's
    // per-edge price toast would stack fifteen times here, and the summary toast below says it once
    const now = new Date().toISOString();
    for (const id of cited) {
      if (id === turn.focus) continue;
      const src = st.nodes.find((n) => n.id === id)!;
      const vertical = position.y > src.position.y + 60 && Math.abs(position.x - src.position.x) < 320;
      newEdges.push({ id: `crosslink-${id}-${node.id}`, source: id, sourceHandle: vertical ? 'continue' : 'branch', target: node.id, targetHandle: vertical ? 'top' : 'left', type: 'smoothstep', style: { stroke: COLORS.accent, strokeDasharray: '8 4', strokeWidth: 2 }, animated: true, data: { isCrossLink: true, createdAt: now } });
    }
    st.setNodes([...st.nodes, node]);
    st.setEdges([...useStore.getState().edges, ...newEdges]);
    for (const e of newEdges) useStore.getState().logEvent('connect', e.id);
    useStore.getState().logEvent('ask', node.id, { chars: question.length });
    toast('success', fmt(t('chat.dropped'), { n: cited.length }), 6000);
    onLocate(node.id);
  };

  if (!open) return null;
  const questionOf = (i: number): string => { for (let k = i - 1; k >= 0; k--) if (turns[k].role === 'user') return turns[k].text; return ''; };
  const chip = (id: string, alias: string, key: string) => {
    const n = nodes.find((x) => x.id === id);
    return <button key={key} type="button" className="cite-chip" title={n ? nodeLabel(n.data, lang) : alias} onClick={() => onLocate(id)} onMouseEnter={() => beacon(id)} onMouseLeave={() => beacon(null)} data-cite={id}>{alias}</button>;
  };
  // the answer is markdown with its citations as explore marks: one click handler locates the node a mark names,
  // and hovering a mark lights that node on the canvas with the beacon the "continue last thought" button uses
  // (a ripple that shows on cards, plaques and glyphs alike), so the reader sees where a claim rests
  const markId = (e: ReactMouseEvent): string | null => (e.target as HTMLElement).closest?.('mark[data-explore-target]')?.getAttribute('data-explore-target') || null;
  const onAnswerClick = (e: ReactMouseEvent) => { const id = markId(e); if (id) { e.stopPropagation(); onLocate(id); } };
  const beacon = (id: string | null) => useUiStore.getState().setBeaconNodeId(id);
  const onAnswerOver = (e: ReactMouseEvent) => beacon(markId(e));
  const onAnswerOut = () => beacon(null);
  const suggest = (q: string) => { setDraft(q); window.setTimeout(() => { const ta = document.querySelector<HTMLTextAreaElement>('[data-chat-input]'); ta?.focus(); ta?.setSelectionRange(q.length, q.length); }, 0); };
  const SUGGESTIONS: { k: 'Overview' | 'Locate' | 'Grounds' | 'Compare' | 'Progress' }[] = [{ k: 'Overview' }, { k: 'Locate' }, { k: 'Grounds' }, { k: 'Compare' }, { k: 'Progress' }];
  return (
    <div className="fixed bottom-4 right-4 z-[85] w-[440px] max-w-[calc(100vw-32px)] max-h-[72vh] flex flex-col rounded-2xl border border-line bg-card shadow-2xl" data-canvas-chat>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line shrink-0">
        <MessageCircleQuestion size={15} strokeWidth={1.75} className="text-accent" />
        <span className="text-sm font-semibold text-ink flex-1">{t('chat.title')}</span>
        <button type="button" onClick={() => { setTurns([]); saveTurns(projectId, []); }} disabled={!turns.length || busy} className="text-2xs text-ink-faint hover:text-ink disabled:opacity-40" data-chat-clear>{t('chat.clear')}</button>
        <button type="button" onClick={onClose} className="text-ink-faint hover:text-ink w-7 h-7 rounded-full flex items-center justify-center hover:bg-wash" title={t('common.close')}><X size={15} strokeWidth={1.75} /></button>
      </div>
      <div ref={list} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm" data-chat-turns>
        {!turns.length && (
          <div className="text-xs text-ink-muted leading-relaxed space-y-2" data-chat-empty>
            <p>{t('chat.empty')}</p>
            <div className="flex items-center gap-1 flex-wrap text-2xs">
              <span className="text-ink-faint mr-0.5">{t('chat.sug')}</span>
              {SUGGESTIONS.map(({ k }) => (
                <button key={k} type="button" onClick={() => suggest(t(`chat.sug${k}Q`))} title={t(`chat.sug${k}Q`)} className="px-2 py-0.5 rounded-full bg-wash text-ink-muted hover:text-accent hover:bg-accent/10 transition-colors" data-chat-suggest={k.toLowerCase()}>{t(`chat.sug${k}`)}</button>
              ))}
            </div>
          </div>
        )}
        {turns.map((turn, i) => turn.role === 'user' ? (
          <div key={turn.id} className="flex flex-col items-end gap-1" data-chat-turn="user">
            <div className="max-w-[88%] bg-accent/10 text-ink rounded-2xl rounded-br-md px-3 py-2 whitespace-pre-wrap break-words">{turn.text}</div>
            {turn.focus && byId.has(turn.focus) && <span className="text-2xs text-ink-faint">{t('chat.focus')} {chip(turn.focus, byId.get(turn.focus)!, `${turn.id}-f`)}</span>}
          </div>
        ) : (
          <div key={turn.id} className="flex flex-col items-start gap-1" data-chat-turn="assistant">
            {turn.error
              ? <div className="max-w-[92%] text-xs text-red-500 bg-red-50 rounded-2xl rounded-bl-md px-3 py-2 break-words">{turn.error}</div>
              : <div className="max-w-[92%] bg-wash text-ink rounded-2xl rounded-bl-md px-3 py-2 markdown-body text-sm leading-relaxed break-words" onClick={onAnswerClick} onMouseOver={onAnswerOver} onMouseOut={onAnswerOut} data-chat-answer>
                  <Markdown>{answerForCanvas(turn.text, mapOf(turn), nodes, lang, 'alias')}</Markdown>
                </div>}
            {!turn.error && (
              <div className="flex items-center gap-2 text-2xs text-ink-faint pl-1">
                {turn.model && <span className="font-mono">{turn.model.split('/').pop()}</span>}
                {(!turn.project || turn.project === projectId) && <button type="button" onClick={() => drop(turn, questionOf(i))} className="text-accent hover:underline" data-chat-drop>{t('chat.drop')}</button>}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="flex items-center gap-1.5 text-xs text-ink-faint"><Loader2 size={12} className="animate-spin" /> {t('chat.thinking')}</div>}
      </div>
      <div className="border-t border-line px-3 py-2 shrink-0 space-y-1.5">
        {/* the five things people ask a canvas (overview, locate, grounds, compare, progress): in the empty
            state they sit under the one-line intro; once a conversation is on, a quiet row above the input */}
        {turns.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap text-2xs" data-chat-suggestions>
            {SUGGESTIONS.map(({ k }) => (
              <button key={k} type="button" onClick={() => suggest(t(`chat.sug${k}Q`))} title={t(`chat.sug${k}Q`)} className="px-2 py-0.5 rounded-full bg-wash text-ink-muted hover:text-accent hover:bg-accent/10 transition-colors" data-chat-suggest={k.toLowerCase()}>{t(`chat.sug${k}`)}</button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1.5 text-2xs text-ink-faint min-w-0" data-chat-focus>
          {focusNode
            ? <><span className="shrink-0">{t('chat.focus')}</span><button type="button" onClick={() => onLocate(focusNode.id)} className="text-accent truncate min-w-0 hover:underline">{nodeLabel(focusNode.data, lang).split('：')[0]}</button><button type="button" onClick={() => setFocusCleared(true)} className="shrink-0 w-5 h-5 rounded-full hover:bg-wash flex items-center justify-center" title={t('chat.focusAll')}><X size={11} /></button></>
            : <span className="truncate min-w-0"><span className="text-ink-muted">{t('chat.focusAll')}</span> · {t('chat.focusAllHint')}</span>}
        </div>
        <div className="flex items-end gap-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !isImeComposing(e)) { e.preventDefault(); void send(); } if (e.key === 'Escape') onClose(); }}
            placeholder={t('chat.placeholder')}
            rows={1}
            className="flex-1 bg-wash text-sm text-ink rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent/40 resize-none placeholder-ink-faint max-h-[120px]"
            onInput={(e) => { const ta = e.currentTarget; ta.style.height = 'auto'; ta.style.height = `${Math.min(120, ta.scrollHeight)}px`; }}
            data-chat-input
          />
          <button type="button" onClick={() => void send()} disabled={!draft.trim() || busy} className="w-8 h-8 rounded-lg bg-accent text-white flex items-center justify-center disabled:opacity-30 shrink-0" title={t('chat.send')} data-chat-send><Send size={14} strokeWidth={1.75} /></button>
        </div>
      </div>
    </div>
  );
}
