// A model asked without tools sometimes writes the call it wanted into its
// answer as text: DeepSeek's DSML, the XML other models use. The stored
// answer keeps it verbatim; the display folds each call to one line, and a
// node can hand the question to the same model's agent, which does run
// tools (#74). Code fences are left alone: an answer that QUOTES such
// markup (a bug report, this very file) is not a call.

const BAR = '[｜|]{1,2}';
const DSML = new RegExp(`<${BAR}\\s*DSML\\s*${BAR}\\s*(?:function_)?calls\\s*>[\\s\\S]*?(?:<\\/${BAR}\\s*DSML\\s*${BAR}\\s*(?:function_)?calls\\s*>|$)`, 'g');
const XML = /<(function_calls|tool_calls?)>[\s\S]*?(?:<\/\1>|$)/g;
// a bare invoke with no wrapper; runs after the wrapped forms are folded
const INVOKE = /<invoke name="[^"]+">[\s\S]*?(?:<\/invoke>|$)/g;
const FENCE = /(```[\s\S]*?```)/g;

function namesIn(block: string): string[] {
  const names = [...block.matchAll(/invoke name="([^"]+)"/g)].map((m) => m[1]);
  if (names.length === 0) names.push(...[...block.matchAll(/"name"\s*:\s*"([^"]+)"/g)].map((m) => m[1]));
  return [...new Set(names)];
}

function eachOutsideFences(text: string, fn: (prose: string) => string): string {
  return text.split(FENCE).map((seg, i) => (i % 2 === 1 ? seg : fn(seg))).join('');
}

/** The tools a text calls as text, in order; [] when it calls none. */
export function toolCallsIn(text: string): string[] {
  if (!text.includes('<')) return [];
  const names: string[] = [];
  let found = false;
  eachOutsideFences(text, (prose) => {
    for (const re of [DSML, XML, INVOKE]) {
      prose = prose.replace(re, (block) => { found = true; names.push(...namesIn(block)); return ''; });
    }
    return prose;
  });
  return found ? [...new Set(names)] : [];
}

/** The text with every call folded to `fold(names)`; prose and fences otherwise untouched. */
export function foldToolCalls(text: string, fold: (names: string[]) => string): string {
  if (!text.includes('<')) return text;
  return eachOutsideFences(text, (prose) => {
    for (const re of [DSML, XML, INVOKE]) prose = prose.replace(re, (block) => fold(namesIn(block)));
    return prose;
  });
}
