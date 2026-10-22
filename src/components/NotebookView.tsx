import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Attachment } from '../types';
import { loadAttachmentContent } from '../lib/attachment-vault';
import { fence, parseNotebook, type NotebookOutput, type ParsedNotebook } from '../lib/notebook';
import { Markdown } from './Markdown';
import { useT } from '../i18n';

// The original view for a notebook: its cells as the author left them —
// text, code with its run number, every saved output in full and the
// figures inline. Nothing executes: HTML and widget outputs show as a line,
// SVG figures draw through <img> (scripts inside never run there). The text
// view shows what the model reads instead (lib/notebook.ts).

const outputBox = 'text-xs font-mono whitespace-pre-wrap break-words max-h-[28rem] overflow-auto rounded-lg border px-3 py-2';

function Output({ o }: { o: NotebookOutput }) {
  const t = useT();
  if (o.kind === 'text') return <pre className={`${outputBox} text-ink bg-card border-line`}>{o.text.replace(/\n+$/, '')}</pre>;
  if (o.kind === 'error') return <pre className={`${outputBox} text-red-700 bg-red-50/60 border-red-200`}>{o.text}</pre>;
  // figures keep a white ground: plots are drawn for paper, often transparent
  if (o.kind === 'image') return <img src={`data:${o.mimeType};base64,${o.data}`} alt={o.label} className="max-w-full rounded-lg border border-line/60 bg-white" />;
  if (o.kind === 'vector') return <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(o.svg)}`} alt={o.label} className="max-w-full rounded-lg border border-line/60 bg-white" />;
  return <p className="text-2xs text-ink-faint italic">{t('reader.notebookInteractive')}</p>;
}

export function NotebookView({ att }: { att: Attachment }) {
  const t = useT();
  const [nb, setNb] = useState<ParsedNotebook | null>(null);
  const [failed, setFailed] = useState(false);

  // keyed by attachment id in the reader: one load per instance
  useEffect(() => {
    let dead = false;
    loadAttachmentContent(att)
      .then((raw) => { if (!dead) setNb(parseNotebook(raw)); })
      .catch(() => { if (!dead) setFailed(true); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // no original to hand (a shared viewer, a cleared vault): the converted copy still reads
  if (failed) {
    return (
      <div className="max-w-[820px] mx-auto px-8 py-6 markdown-body text-sm text-ink leading-relaxed">
        {att.extractedText?.trim() ? <Markdown>{att.extractedText}</Markdown> : <p className="text-ink-faint italic">{t('reader.empty')}</p>}
      </div>
    );
  }
  if (!nb) {
    return (
      <div className="flex items-center justify-center gap-2 h-full min-h-[200px] text-sm text-ink-muted">
        <Loader2 size={16} strokeWidth={1.75} className="animate-spin text-accent" /> {t('reader.loading')}
      </div>
    );
  }
  return (
    <div className="max-w-[820px] mx-auto px-8 py-6 space-y-4" data-notebook>
      {nb.cells.map((c, i) => (
        c.kind === 'markdown' ? (
          <div key={i} className="markdown-body text-sm text-ink leading-relaxed"><Markdown>{c.source}</Markdown></div>
        ) : c.kind === 'raw' ? (
          <pre key={i} className={`${outputBox} text-ink-muted bg-card border-line`}>{c.source}</pre>
        ) : (
          <div key={i} className="space-y-2">
            <div className="flex gap-2">
              <span className="w-9 shrink-0 pt-2.5 text-right text-2xs font-mono text-ink-faint select-none">[{c.count ?? ' '}]</span>
              <div className="flex-1 min-w-0 markdown-body text-sm"><Markdown>{fence(c.source, nb.lang)}</Markdown></div>
            </div>
            {c.outputs.map((o, j) => (
              <div key={j} className="pl-11"><Output o={o} /></div>
            ))}
          </div>
        )
      ))}
    </div>
  );
}
