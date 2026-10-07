import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { useUiStore } from './ui-store';

// The docked reader's geometry, decided in ONE place for the two things that
// depend on it: the canvas (which steps aside by the dock's width) and the
// reader (which renders as a column, a collapsed strip, or the full-screen
// overlay). The rule: the reader docks on the left when the window is wide
// enough, and the canvas keeps at least CANVAS_MIN_WIDTH beside it. When the
// node panel is open as well, the person is reading the text and the answer
// side by side, not the map: the canvas is what yields then, down to a
// sliver, and the reader keeps its width. Only when even the reader's
// minimum would not fit does it fold to a strip; in a window too narrow to
// dock at all, the overlay.

export const READER_MIN_WIDTH = 380;
export const READER_DEFAULT_WIDTH = 560;
export const READER_STRIP_WIDTH = 44;
/** The canvas never gets narrower than this beside the dock while it is the
 *  thing being read (no node panel open). */
export const CANVAS_MIN_WIDTH = 600;
/** With the node panel open, the canvas may shrink to this: wires still show,
 *  but the text and the answer have the room. */
export const CANVAS_MIN_BESIDE_PANEL = 200;
/** Below this window width there is no room to dock: the overlay shows. */
export const DOCK_MIN_WINDOW = 1000;
/** The node panel's right inset plus a gap, so the three never touch. */
const PANEL_GUTTER = 24;

export interface ReaderDock {
  /** the reader is open and shows as a column (or a strip) on the left */
  docked: boolean;
  /** docked but folded to a strip: not even the minimum column fits */
  collapsed: boolean;
  /** the width the canvas must step aside by: column, strip, or 0 */
  width: number;
  /** the widest the column may be right now (resize upper bound) */
  maxWidth: number;
}

function useWindowWidth(): number {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

export function useReaderDock(): ReaderDock {
  const windowWidth = useWindowWidth();
  const readerOpen = useUiStore((s) => !!s.readerNodeId);
  const mode = useUiStore((s) => s.readerMode);
  const readerWidth = useUiStore((s) => s.readerWidth);
  const panelWidth = useUiStore((s) => s.panelWidth);
  const panelMode = useUiStore((s) => s.panelOpen);
  // the panel shows for a selected ordinary node while panel mode is on (App's panelOpen)
  const panelShowing = useStore((s) => {
    if (!panelMode || !s.selectedNodeId) return false;
    const n = s.nodes.find((x) => x.id === s.selectedNodeId);
    return !!n && !['note', 'file', 'link', 'frame'].includes(n.data.stepKind ?? '');
  });
  const docked = readerOpen && mode === 'dock' && windowWidth >= DOCK_MIN_WINDOW;
  const maxWidth = panelShowing
    ? windowWidth - panelWidth - PANEL_GUTTER - CANVAS_MIN_BESIDE_PANEL
    : windowWidth - CANVAS_MIN_WIDTH;
  const collapsed = docked && maxWidth < READER_MIN_WIDTH;
  const width = !docked ? 0 : collapsed ? READER_STRIP_WIDTH : Math.min(readerWidth, maxWidth);
  return { docked, collapsed, width, maxWidth };
}
