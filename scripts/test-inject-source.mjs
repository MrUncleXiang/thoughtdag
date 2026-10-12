// The attribution the plugin puts on injected messages (#69).
//
// The harness's native v4 session format refuses a message whose source kind
// is the bare shared literal 'plugin': its validator throws before the Session
// adopts the event, the targeted turn dies, and nothing is persisted. The rule
// (from @deepseek-ai/dsh-session-format-v3-to-v4's `source(message)`): kind is
// a non-empty string and not "plugin". This holds dsh/lib/index.js to it — both
// inject sites share the one SOURCE constant, so the constant is what matters.
// Usage: `node scripts/test-inject-source.mjs`
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'dsh/lib/index.js'), 'utf8');

let failures = 0;
let checks = 0;
const ok = (name, cond, extra = '') => {
  checks++;
  if (!cond) failures++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
};

/** the host's v4 admission rule for a message source, verbatim in spirit */
const v4Admits = (source) =>
  !!source && typeof source === 'object' && typeof source.kind === 'string' && source.kind.length > 0 && source.kind !== 'plugin';

const m = src.match(/^const SOURCE = (\{[^\n]*\})\s*$/m);
ok('dsh/lib/index.js declares one SOURCE constant', !!m);
let source = null;
if (m) {
  // a plain object literal from our own source file: evaluate it as one
  try { source = new Function(`return (${m[1]})`)(); } catch { source = null; }
}
ok('SOURCE is a plain object', !!source, m?.[1]);
ok('the v4 format admits SOURCE (producer-owned kind, never the bare "plugin")', v4Admits(source), JSON.stringify(source));
ok('the kind names this plugin', typeof source?.kind === 'string' && source.kind.includes('dsh-thoughtdag'), source?.kind);
ok('the plugin field still says who we are', source?.plugin === 'dsh-thoughtdag', source?.plugin);

// both write sites attach the one constant: the ask route's context injection and the inject route
const injectSites = src.match(/agent\.inject\(/g)?.length ?? 0;
const sourced = src.match(/source: SOURCE\b/g)?.length ?? 0;
ok('every agent.inject site carries source: SOURCE', injectSites >= 2 && sourced >= injectSites, `${sourced} of ${injectSites}`);
ok('no inject site still writes the bare kind', !/kind:\s*'plugin'\s*[,}]/.test(src));

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
