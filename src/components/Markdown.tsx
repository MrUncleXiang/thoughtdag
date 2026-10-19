import { createContext, memo, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Schema } from 'hast-util-sanitize';
import type { Element, ElementContent } from 'hast';
import type { PluggableList } from 'unified';
import { Check, Code2, Copy, Workflow } from 'lucide-react';
import { fuzzyHighlightRegex } from '../lib/highlight-match';
import { useT, fmt } from '../i18n';
import { localPathOf, openLocalPath, basenameOf } from '../lib/local-path';
import { foldToolCalls } from '../lib/tool-markup';
import { useAppearance } from '../lib/appearance';

const REMARK_PLUGINS = [remarkGfm, remarkMath];

// Models freely emit \( \) and \[ \] math delimiters; remark-math only
// parses $-style. Normalize outside code fences/spans so formulas render
// everywhere (cards, panel, rail, reader) instead of leaking raw.
function normalizeMath(src: string): string {
  if (!src || (!src.includes('\\(') && !src.includes('\\['))) return src;
  const parts = src.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts
    .map((seg, i) => (i % 2 === 1 ? seg : seg
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `\n$$\n${m.trim()}\n$$\n`)
      .replace(/\\\((.+?)\\\)/g, (_, m) => `$${m.trim()}$`)))
    .join('');
}
// Raw HTML in an answer is kept for what it is used for (details, sub/sup,
// kbd, mark, tables, line breaks) and stripped of what can run or embed:
// iframe, object, embed, script, style, link, meta, base, form. An answer is
// untrusted text (a shared graph, an imported project, a model quoting a
// page), and a srcdoc iframe runs with this origin's storage and bridges.
// The sanitizer sits after rehype-raw and before highlight and KaTeX, so
// their own markup (hljs spans, KaTeX styles) is never touched.
const SANITIZE_SCHEMA: Schema = {
  ...defaultSchema,
  // footnote ids already carry mdast's own user-content- prefix; a second one would break their links
  clobberPrefix: '',
  tagNames: [...(defaultSchema.tagNames ?? []), 'mark'],
  attributes: {
    ...defaultSchema.attributes,
    // remark-math marks its code as language-math plus math-inline / math-display; KaTeX reads all three
    code: [['className', /^language-./, 'math-inline', 'math-display']],
    // the marks this file injects itself: a user highlight, and an explore trace whose target the hosts read on click
    mark: [['className', 'highlight-mark', 'explore-mark'], 'dataExploreTarget'],
  },
};
const REHYPE_PLUGINS: PluggableList = [rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA], rehypeHighlight, rehypeKatex];

// Code blocks get a hover copy button (no toast: too frequent an action —
// the icon flashes a check instead).
function CodePre(props: React.HTMLAttributes<HTMLPreElement>) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const t = useT();
  return (
    <div className="relative group/pre">
      <pre {...props} ref={ref} />
      <button
        onClick={(e) => {
          e.stopPropagation();
          void navigator.clipboard.writeText(ref.current?.innerText ?? '');
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
        title={t('common.copyCode')}
        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md bg-card/90 border border-line text-ink-faint hover:text-accent flex items-center justify-center opacity-0 group-hover/pre:opacity-100 transition-opacity nodrag nopan"
      >
        {copied ? <Check size={12} strokeWidth={2} className="text-green-600" /> : <Copy size={12} strokeWidth={1.75} />}
      </button>
    </div>
  );
}

// A ```mermaid block is drawn where there is room to read it (panel,
// reader, viewer). A canvas card draws a fixed-height stand-in instead:
// the card's height is what layout spaced the nodes below by, and a
// diagram arriving after the first paint would grow the card into them.
type DiagramMode = 'render' | 'placeholder';
const DiagramContext = createContext<DiagramMode>('render');

const textOf = (n: ElementContent): string => (n.type === 'text' ? n.value : 'children' in n ? n.children.map(textOf).join('') : '');

function mermaidSource(pre: Element | undefined): string | null {
  const code = pre?.children.find((c): c is Element => c.type === 'element' && c.tagName === 'code');
  const cls = code?.properties?.className;
  if (!code || !Array.isArray(cls) || !cls.includes('language-mermaid')) return null;
  return textOf(code);
}

// mermaid is large: fetched the first time a diagram is drawn, never on a canvas that has none
let mermaidLoad: Promise<typeof import('mermaid').default> | null = null;
const loadMermaid = () => (mermaidLoad ??= import('mermaid').then((m) => m.default));
let mermaidSeq = 0;

function MermaidBlock({ code, source }: { code: string; source: ReactNode }) {
  const t = useT();
  const theme = useAppearance((s) => s.resolved);
  const [svg, setSvg] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  useEffect(() => {
    let live = true;
    // a streaming answer re-renders on every chunk: draw once the text settles;
    // until it parses (a half-written block), the source shows
    const timer = setTimeout(() => {
      void loadMermaid()
        .then(async (mermaid) => {
          // strict: labels are sanitized and the diagram carries no click handlers or scripts
          mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: theme === 'dark' ? 'dark' : 'neutral' });
          if (!(await mermaid.parse(code, { suppressErrors: true }))) { if (live) setSvg(null); return; }
          const out = await mermaid.render(`td-mermaid-${++mermaidSeq}`, code);
          if (live) setSvg(out.svg);
        })
        .catch(() => { if (live) setSvg(null); });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [code, theme]);
  const toggle = svg && (
    <button
      onClick={(e) => { e.stopPropagation(); setShowSource((v) => !v); }}
      title={showSource ? t('md.diagramView') : t('md.diagramSource')}
      className={`absolute top-1.5 ${showSource ? 'right-9' : 'right-1.5'} w-6 h-6 rounded-md bg-card/90 border border-line text-ink-faint hover:text-accent flex items-center justify-center opacity-0 group-hover/diagram:opacity-100 transition-opacity nodrag nopan`}
      data-diagram-toggle
    >
      {showSource ? <Workflow size={12} strokeWidth={1.75} /> : <Code2 size={12} strokeWidth={1.75} />}
    </button>
  );
  return (
    <div className="relative group/diagram">
      {svg && !showSource
        ? <div className="my-2 overflow-x-auto flex justify-center [&_svg]:max-w-full [&_svg]:h-auto" data-diagram dangerouslySetInnerHTML={{ __html: svg }} />
        : source}
      {toggle}
    </div>
  );
}

function DiagramPlaceholder() {
  const t = useT();
  return (
    <div className="h-12 my-2 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-line text-xs text-ink-faint select-none" data-diagram-placeholder>
      <Workflow size={13} strokeWidth={1.75} /> {t('md.diagramPlaceholder')}
    </div>
  );
}

function Pre({ node, ...props }: React.HTMLAttributes<HTMLPreElement> & ExtraProps) {
  const mode = useContext(DiagramContext);
  const code = mermaidSource(node);
  if (code === null) return <CodePre {...props} />;
  if (mode === 'placeholder') return <DiagramPlaceholder />;
  return <MermaidBlock code={code} source={<CodePre {...props} />} />;
}

// Wide tables scroll inside their own container instead of blowing the card
function Table(props: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table {...props} />
    </div>
  );
}

// Links leave the card, never the app. A web URL opens a new tab (the
// desktop shell hands it to the system browser); a LOCAL path — a file
// or folder the agent named — opens on this machine and never becomes a
// web address. Either way the click does not reach the canvas as a node
// selection.
// The writer's working directory, when the text came from a session: a
// relative path in it resolves against this, not against the app.
const BaseContext = createContext<string | undefined>(undefined);

function Anchor(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const local = localPathOf(props.href, useContext(BaseContext));
  if (local) {
    return (
      <a
        {...props}
        title={local}
        data-local-path={local}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); void openLocalPath(local); }}
      />
    );
  }
  return <a {...props} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()} />;
}

// An image the agent produced shows inline, read from disk through the
// shell; where there is no disk (the browser) a chip names the file.
function LocalImage({ path, alt }: { path: string; alt?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  // no shell, no disk: the chip is final from the first paint
  const [failed, setFailed] = useState(() => !window.desktopLocal);
  useEffect(() => {
    const bridge = window.desktopLocal;
    if (!bridge) return;
    let live = true;
    void bridge.image(path).then((d) => { if (!live) return; if (d) setSrc(d); else setFailed(true); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [path]);
  if (src) {
    return <img src={src} alt={alt ?? basenameOf(path)} title={path} className="cursor-zoom-in nopan" onClick={(e) => { e.stopPropagation(); void openLocalPath(path); }} />;
  }
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs border border-line rounded-md px-1.5 py-0.5 font-mono nopan cursor-pointer ${failed ? 'text-ink-faint' : 'text-ink-muted'}`}
      title={path}
      data-local-image={path}
      onClick={(e) => { e.stopPropagation(); void openLocalPath(path); }}
    >
      🖼 {basenameOf(path)}
    </span>
  );
}

function Img(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  const local = localPathOf(props.src, useContext(BaseContext));
  if (local) return <LocalImage path={local} alt={props.alt} />;
  return <img {...props} />;
}

const COMPONENTS = { pre: Pre, table: Table, a: Anchor, img: Img };

// Standard markdown rendering (GFM + math + syntax highlighting).
// memo: the unified parse + KaTeX layout is the most expensive render on a
// card, and cards re-render far more often than their text changes (every
// streamed chunk anywhere re-renders every card). Same string → skip.
export const Markdown = memo(function Markdown({ children, base, diagrams = 'render' }: { children: string; base?: string; diagrams?: DiagramMode }) {
  const t = useT();
  // a tool call the model wrote as text did not run: say so in one line instead of showing the markup
  const text = foldToolCalls(normalizeMath(children), (names) => `\n\n> ⚙ ${fmt(t('md.toolCallFolded'), { names: names.map((n) => `\`${n}\``).join(', ') || '?' })}\n\n`);
  return (
    <BaseContext.Provider value={base}>
      <DiagramContext.Provider value={diagrams}>
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={COMPONENTS}>
          {text}
        </ReactMarkdown>
      </DiagramContext.Provider>
    </BaseContext.Provider>
  );
});

// one stable class, styled in index.css: the sanitizer's allow-list names it, and a style change never has to
const MARK_OPEN = '<mark class="highlight-mark">';

// A match spanning list items / paragraphs / table cells cannot live in
// ONE <mark>: an inline tag wrapped around "\n- item" breaks the block
// parse, and a tag swallowing a table's "|" breaks the row into mismatched
// cells. Wrap each line's CONTENT separately — list/quote/heading prefixes
// and cell pipes stay OUTSIDE the tag; table delimiter rows pass untouched.
function wrapLine(line: string, open: string): string {
  const parsed = line.match(/^(\s*(?:(?:\d{1,3}[.)]|[-*+>]|#{1,6})\s+)*)(.*)$/);
  const prefix = parsed?.[1] ?? '';
  const rest = parsed?.[2] ?? line;
  if (!rest.trim()) return line;
  if (rest.includes('|')) {
    if (/^[\s|:-]+$/.test(rest)) return line; // |---|---| delimiter row
    return prefix + rest
      .split('|')
      .map((cell) => cell.trim()
        ? cell.replace(/^(\s*)([\s\S]*?)(\s*)$/, (_, a, c, b) => `${a}${open}${c}</mark>${b}`)
        : cell)
      .join('|');
  }
  return `${prefix}${open}${rest}</mark>`;
}

function wrapMatch(m: string, open: string): string {
  if (!m.includes('\n') && !m.includes('|')) return `${open}${m}</mark>`;
  return m.split('\n').map((l) => wrapLine(l, open)).join('\n');
}

const escapeAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A passage a child branch explores from: rendered as a warm dotted
    underline (structural trace), never a fill (fills belong to the user's
    own highlights). data-explore-target lets hosts delegate clicks. */
export interface ExploreMarkSpec { text: string; nodeId: string; title: string }

// Markdown with user highlights (and explore traces) wrapped in <mark>
// before rendering. Callers rebuild the Set/array props every render, so
// memo compares by CONTENT (see areMarkPropsEqual below).
export const HighlightedMarkdown = memo(function HighlightedMarkdown({ content, highlights, exploreMarks, diagrams }: HMProps) {
  // Fuzzy-locate every span in the CLEAN markdown source first, then splice
  // tags in back-to-front. A second replace pass over already-tagged text
  // would let the fuzzy noise classes swallow pieces of the inserted tags
  // (`>` is legal markdown noise, so a match can start ON a tag's closing
  // bracket) and emit broken HTML — locating on the pristine source makes
  // that impossible. Selections come from the RENDERED text and cross
  // bold/list/line-break syntax; wrapping the matched source verbatim keeps
  // its markdown rendering inside <mark>.
  const spans: { start: number; end: number; open: string; prio: number }[] = [];
  const collect = (text: string, open: string, prio: number) => {
    const re = fuzzyHighlightRegex(text);
    if (!re) return;
    for (const m of content.matchAll(re)) {
      if (m[0]) spans.push({ start: m.index!, end: m.index! + m[0].length, open, prio });
    }
  };
  for (const h of highlights) collect(h, MARK_OPEN, 0);
  for (const em of exploreMarks ?? []) {
    collect(em.text, `<mark class="explore-mark" data-explore-target="${escapeAttr(em.nodeId)}" title="${escapeAttr(em.title)}">`, 1);
  }
  // Overlaps: the user's own highlight outranks the structural trace.
  spans.sort((a, b) => a.prio - b.prio || a.start - b.start);
  const kept: typeof spans = [];
  for (const s of spans) {
    if (kept.some((k) => s.start < k.end && k.start < s.end)) continue;
    kept.push(s);
  }
  kept.sort((a, b) => b.start - a.start); // splice back-to-front so offsets hold
  let processed = content;
  for (const s of kept) {
    processed = processed.slice(0, s.start) + wrapMatch(processed.slice(s.start, s.end), s.open) + processed.slice(s.end);
  }
  return <Markdown diagrams={diagrams}>{processed}</Markdown>;
}, areMarkPropsEqual);

type HMProps = { content: string; highlights: Set<string>; exploreMarks?: ExploreMarkSpec[]; diagrams?: DiagramMode };
function areMarkPropsEqual(prev: HMProps, next: HMProps): boolean {
  if (prev.content !== next.content || prev.diagrams !== next.diagrams) return false;
  if (prev.highlights.size !== next.highlights.size) return false;
  for (const h of prev.highlights) if (!next.highlights.has(h)) return false;
  const a = prev.exploreMarks ?? [];
  const b = next.exploreMarks ?? [];
  if (a.length !== b.length) return false;
  return a.every((m, i) => m.text === b[i].text && m.nodeId === b[i].nodeId && m.title === b[i].title);
}
