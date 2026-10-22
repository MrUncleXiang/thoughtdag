// Notebooks (.ipynb, nbformat 4) as material. The raw JSON goes to the
// attachment vault and serves the reader's original view; extractedText
// (markdown cells, code cells, saved outputs) is the model channel, and the
// figures ride the image channel like pasted images.
//
// The saved outputs are framed as a record of the author's last run. Shown
// as Jupyter's In/Out cells, a model without a kernel answers "change this
// and run it again" with results it invented (measured 2026-10-22 on a real
// notebook: In/Out 4/12 invented runs on one model, this framing 0/24 on
// both); with the framing it says what to run, and every saved number stays.

import type { Attachment } from '../types';
import type { ContextMessage } from './api';

export const NOTEBOOK_TYPE = 'application/x-ipynb+json';
export const NOTEBOOK_EXTENSION = /\.ipynb$/i;
/** above this many figures a notebook starts text only (one vision request
    per figure trips provider image limits, as PDF pages did) */
export const NOTEBOOK_FIGURE_THRESHOLD = 10;

export const isNotebook = (att: { type: string }): boolean => att.type === NOTEBOOK_TYPE;

export interface NotebookFigure { data: string; mimeType: string }

export type NotebookOutput =
  | { kind: 'text'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'image'; data: string; mimeType: string; label: string }
  | { kind: 'vector'; svg: string; label: string }
  | { kind: 'interactive' };

export interface NotebookCell {
  kind: 'markdown' | 'code' | 'raw';
  source: string;
  count: number | null;
  outputs: NotebookOutput[];
}

export interface ParsedNotebook { lang: string; cells: NotebookCell[] }

const join = (x: unknown): string => (Array.isArray(x) ? x.join('') : typeof x === 'string' ? x : '');
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
// a progress bar rewrites its line with \r: keep what the terminal showed last
const settle = (s: string) => s.replace(ANSI, '').split('\n').map((l) => l.slice(l.lastIndexOf('\r') + 1)).join('\n');
const RASTER = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

function readOutput(o: Record<string, unknown>): NotebookOutput | null {
  if (o.output_type === 'stream') return { kind: 'text', text: settle(join(o.text)) };
  if (o.output_type === 'error') {
    const tb = settle((Array.isArray(o.traceback) ? o.traceback : []).join('\n')).trim();
    return { kind: 'error', text: tb || `${o.ename ?? 'Error'}: ${o.evalue ?? ''}` };
  }
  const d = (o.data ?? {}) as Record<string, unknown>;
  // a table's plain form is aligned by its leading spaces: trim only the label
  const plain = join(d['text/plain']);
  const raster = RASTER.find((m) => join(d[m]));
  if (raster) return { kind: 'image', data: join(d[raster]).replace(/\s+/g, ''), mimeType: raster, label: plain.trim() };
  if (d['image/svg+xml']) return { kind: 'vector', svg: join(d['image/svg+xml']), label: plain.trim() };
  const text = join(d['text/markdown']) || join(d['text/latex']) || plain;
  if (text.trim()) return { kind: 'text', text };
  if (Object.keys(d).length) return { kind: 'interactive' };
  return null;
}

/** Parse a notebook's JSON. Throws on anything that is not nbformat 4. */
export function parseNotebook(raw: string): ParsedNotebook {
  const nb = JSON.parse(raw) as { nbformat?: number; cells?: unknown; metadata?: { kernelspec?: { language?: string }; language_info?: { name?: string } } };
  if (nb.nbformat !== 4 || !Array.isArray(nb.cells)) throw new Error('not an nbformat 4 notebook');
  const lang = nb.metadata?.kernelspec?.language ?? nb.metadata?.language_info?.name ?? '';
  const cells = (nb.cells as Record<string, unknown>[]).map((c): NotebookCell => ({
    kind: c.cell_type === 'markdown' ? 'markdown' : c.cell_type === 'code' ? 'code' : 'raw',
    source: join(c.source),
    count: typeof c.execution_count === 'number' ? c.execution_count : null,
    outputs: c.cell_type === 'code' && Array.isArray(c.outputs)
      ? (c.outputs as Record<string, unknown>[]).map(readOutput).filter((x): x is NotebookOutput => !!x)
      : [],
  }));
  return { lang, cells };
}

export const fence = (body: string, lang = '') => {
  const ticks = body.includes('```') ? '````' : '```';
  return `${ticks}${lang}\n${body.replace(/\n+$/, '')}\n${ticks}`;
};

// A training log can run to thousands of lines: the model gets its head and
// tail, and the cut says how much is missing
const HEAD_LINES = 40, TAIL_LINES = 40, MAX_CHARS = 8000;
function clipOutput(text: string): string {
  let lines = text.replace(/\n+$/, '').split('\n');
  if (lines.length > HEAD_LINES + TAIL_LINES) {
    lines = [...lines.slice(0, HEAD_LINES), `… (${lines.length - HEAD_LINES - TAIL_LINES} lines omitted) …`, ...lines.slice(-TAIL_LINES)];
  }
  const s = lines.join('\n');
  if (s.length <= MAX_CHARS) return s;
  return `${s.slice(0, MAX_CHARS / 2)}\n… (${s.length - MAX_CHARS} characters omitted) …\n${s.slice(-MAX_CHARS / 2)}`;
}
const ERROR_LINES = 12;
function clipError(text: string): string {
  const lines = text.split('\n');
  return lines.length > ERROR_LINES ? [`… (${lines.length - ERROR_LINES} traceback lines omitted) …`, ...lines.slice(-ERROR_LINES)].join('\n') : text;
}

/** The model channel (extractedText) and the figures, from parsed cells. */
export function notebookMaterial(nb: ParsedNotebook): { text: string; figures: NotebookFigure[] } {
  const parts: string[] = [];
  const figures: NotebookFigure[] = [];
  for (const c of nb.cells) {
    if (c.kind === 'markdown') { if (c.source.trim()) parts.push(c.source); continue; }
    if (c.kind === 'raw') { if (c.source.trim()) parts.push(fence(c.source)); continue; }
    const n = c.count ?? ' ';
    parts.push(`Cell [${n}]:\n${fence(c.source, nb.lang)}`);
    const outs = c.outputs.map((o) => {
      if (o.kind === 'text') return clipOutput(o.text);
      if (o.kind === 'error') return clipError(o.text);
      if (o.kind === 'image') { figures.push({ data: o.data, mimeType: o.mimeType }); return `[figure ${figures.length}: ${o.label || 'image'}]`; }
      if (o.kind === 'vector') return `[vector figure, not attached: ${o.label || 'SVG'}]`;
      return '[interactive output, not shown]';
    }).filter((s) => s.trim());
    if (outs.length) parts.push(`Saved output of cell [${n}] (from the author's last run):\n${fence(outs.join('\n'))}`);
  }
  return { text: parts.join('\n\n'), figures };
}

const RECORD = 'the outputs below were saved when the author last ran each cell in their own kernel. They are a record, kept for reference; this conversation cannot run code. If the question needs something run, say what to run and why; do not state results you have not seen in the context.';
// an agent has a kernel of its own: the record stays a record, the no-run sentence would be false
const AGENT_RECORD = 'the outputs below were saved when the author last ran each cell in their own kernel. They are a record, kept for reference, not results of a run in this conversation.';

/** The notebook as one context message body. */
export const notebookContext = (att: Attachment): string => `[Notebook: ${att.name} — ${RECORD}]\n${att.extractedText ?? ''}`;

/** The same message for an agent request (see recordsForAgent). */
export const notebookForAgent = (m: ContextMessage): ContextMessage =>
  m.role === 'user' && m.content.startsWith('[Notebook: ') && m.content.includes(RECORD)
    ? { ...m, content: m.content.replace(RECORD, AGENT_RECORD) }
    : m;
