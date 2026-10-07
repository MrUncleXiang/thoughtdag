import type { ThoughtNode } from '../types';

// Frame membership, decided in ONE place for everything that asks (today
// only frame dragging: auto layout leaves frames alone since 0.5.17, #64).
// A frame is a region: an ordinary node belongs to it when the node's centre
// lies inside; another frame belongs only when it lies fully inside and is
// smaller. Two frames that merely overlap share the nodes in their overlap
// and never own each other — so dragging one of them cannot steal the other
// away from its own members (#40).

export type Rect = { x: number; y: number; width: number; height: number };

/** A frame's rectangle: the measured size once React Flow has it, else the stored one. */
export function frameRect(frame: ThoughtNode): Rect {
  return {
    x: frame.position.x,
    y: frame.position.y,
    width: frame.measured?.width ?? frame.width ?? 0,
    height: frame.measured?.height ?? frame.height ?? 0,
  };
}

/** A node's centre, with the card's default footprint before it is measured. */
export function nodeCenter(node: ThoughtNode): { x: number; y: number } {
  return {
    x: node.position.x + (node.measured?.width ?? 520) / 2,
    y: node.position.y + (node.measured?.height ?? 120) / 2,
  };
}

export const isFrameNode = (n: ThoughtNode): boolean => n.data.stepKind === 'frame';

/** `inner` lies fully inside `outer` and is strictly smaller: the only
 *  relation that nests one frame in another. */
export function frameContains(outer: Rect, inner: Rect): boolean {
  const strictlyLarger = outer.width * outer.height > inner.width * inner.height;
  return strictlyLarger
    && inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

/** The nodes a frame owns right now: ordinary nodes by centre, frames by
 *  full containment. Callers that must not move a node twice (a multi-select
 *  drag) filter the selection out themselves. */
export function frameMembers(frame: ThoughtNode, nodes: ThoughtNode[]): ThoughtNode[] {
  const r = frameRect(frame);
  return nodes.filter((n) => {
    if (n.id === frame.id) return false;
    if (isFrameNode(n)) return frameContains(r, frameRect(n));
    const c = nodeCenter(n);
    return c.x >= r.x && c.x <= r.x + r.width && c.y >= r.y && c.y <= r.y + r.height;
  });
}
