#!/usr/bin/env node
// Layout invariants. autoLayout is pure, but it lives in src/ where the module
// graph reaches import.meta.env, so it is bundled for node the same way the
// benchmark compiler bundles product code (benchmark/tools/build-bundle.sh).
//
// The rules being checked are the canvas grammar, not aesthetics:
//   - a node CONTINUES below every parent it continues from
//   - a node EXPLORED out of a parent stands beside it, never above its top
//   - no two thought cards overlap
//   - the same graph, handed over in a different order, lays out the same way
//
// Run: node scripts/test-layout.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'tdag-layout-'));
const bundle = join(tmp, 'layout.mjs');
execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [
  join(ROOT, 'src/lib/layout.ts'), '--bundle', '--format=esm', '--platform=node',
  `--outfile=${bundle}`, '--define:import.meta.env.VITE_API_BASE=""',
  '--define:import.meta.env.DEV=false',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const { autoLayout, nodeHeight } = await import(pathToFileURL(bundle).href);
const framesBundle = join(tmp, 'frames.mjs');
execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [
  join(ROOT, 'src/lib/frames.ts'), '--bundle', '--format=esm', '--platform=node', `--outfile=${framesBundle}`,
], { stdio: ['ignore', 'ignore', 'pipe'] });
const { frameMembers } = await import(pathToFileURL(framesBundle).href);

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const NODE_W = 520;
const CONTENT = new Set(['note', 'file', 'link', 'frame']);
const th = (id, over = {}) => ({
  id, type: 'thought', position: { x: 0, y: 0 },
  data: {
    question: 'q', response: 'r', responses: ['r'], responseIndex: 0,
    isCollapsed: true, isEditing: false, isEditingResponse: false, isLoading: false,
    tokenCount: 0, highlights: [], highlightMode: false, roleMode: 'assistant',
    attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
    isRoot: false, isBranch: false, ...over,
  },
});
const file = (id, x) => ({ ...th(id, { stepKind: 'file' }), position: { x, y: 0 }, measured: { width: 120, height: 120 } });
const frame = (id, x, y, width, height, frameCarry = true) => ({
  ...th(id, { stepKind: 'frame', frameCarry }), position: { x, y }, width, height, zIndex: -1,
});
const placed = (node, x, y, width = 520, height = 120) => ({
  ...node, position: { x, y }, measured: { width, height },
});
const ed = (s, t, data) => ({ id: `${s}->${t}`, source: s, target: t, ...(data ? { data } : {}) });
const xOf = (laid, id) => laid.find((n) => n.id === id).position.x;
const nodeOf = (laid, id) => laid.find((n) => n.id === id);

// Every arrow-order and overlap rule, checked per edge.
function violations(laid, edges) {
  const by = new Map(laid.map((n) => [n.id, n]));
  const out = [];
  for (const e of edges) {
    if (e.data?.isCrossLink) continue;
    const s = by.get(e.source), t = by.get(e.target);
    if (!s || !t || CONTENT.has(s.data?.stepKind) || CONTENT.has(t.data?.stepKind)) continue;
    if (e.data?.isBranchFromSelection) {
      if (t.position.y < s.position.y) out.push(`explore ${e.source}->${e.target} above parent top`);
    } else if (t.position.y < s.position.y + nodeHeight(s)) {
      out.push(`structural ${e.source}->${e.target} above parent bottom`);
    }
  }
  const solid = laid.filter((n) => !CONTENT.has(n.data?.stepKind));
  for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
    const a = solid[i], b = solid[j];
    if (a.position.x < b.position.x + NODE_W && b.position.x < a.position.x + NODE_W &&
        a.position.y < b.position.y + nodeHeight(b) && b.position.y < a.position.y + nodeHeight(a))
      out.push(`overlap ${a.id}/${b.id}`);
  }
  return out;
}

console.log('layout invariants\n');

test('a merge sits under the parent it was continued from: the first edge in, not the median', () => {
  const nodes = ['root', 'p1', 'p2', 'p3', 'merge'].map((i) => th(i));
  const edges = [ed('root', 'p1'), ed('root', 'p2'), ed('root', 'p3'),
                 ed('p3', 'merge'), ed('p1', 'merge'), ed('p2', 'merge')];
  const laid = autoLayout(nodes, edges);
  assert(xOf(laid, 'merge') === xOf(laid, 'p3'),
    `merge at ${xOf(laid, 'merge')}, first parent p3 at ${xOf(laid, 'p3')}`);
});

test('the same graph in a different node order lays out the same way', () => {
  const ids = ['root', 'p1', 'p2', 'p3', 'merge'];
  const edges = [ed('root', 'p1'), ed('root', 'p2'), ed('root', 'p3'),
                 ed('p1', 'merge'), ed('p2', 'merge'), ed('p3', 'merge')];
  const byId = new Map(ids.map((i) => [i, th(i)]));
  const sig = (order) => autoLayout(order.map((i) => byId.get(i)), edges)
    .map((n) => `${n.id}@${Math.round(n.position.x)},${Math.round(n.position.y)}`).sort().join('|');
  const a = sig(ids), b = sig([...ids].reverse()), c = sig(['root', 'p3', 'p1', 'p2', 'merge']);
  assert(a === b && b === c, 'layout changed when the node array was permuted');
});

test('an explore branch follows the merge that moves beneath its parents', () => {
  const nodes = ['rootA', 'rootB', 'B', 'merge', 'branch'].map((i) => th(i));
  const edges = [ed('rootB', 'B'), ed('rootA', 'merge'), ed('B', 'merge'),
                 ed('merge', 'branch', { isBranchFromSelection: true })];
  const laid = autoLayout(nodes, edges);
  assert(violations(laid, edges).length === 0, violations(laid, edges).join('; '));
});

test('a merge continued from one parent and explored from another keeps the plain column', () => {
  const nodes = ['explore', 'a', 'b', 'plain', 'merge'].map((i) => th(i));
  const edges = [ed('a', 'b'), ed('b', 'plain'),
                 ed('explore', 'merge', { isBranchFromSelection: true }), ed('plain', 'merge')];
  const laid = autoLayout(nodes, edges);
  assert(xOf(laid, 'merge') === xOf(laid, 'plain'),
    `merge at ${xOf(laid, 'merge')}, plain parent at ${xOf(laid, 'plain')}`);
});

test('a merge of material-anchored chains follows its first parent, wherever that chain sits', () => {
  const nodes = [file('mLeft', 0), file('mMid', 1000), file('mRight', 2000),
                 th('qRight'), th('qLeft'), th('qMid'), th('merge')];
  const edges = [ed('mRight', 'qRight'), ed('mLeft', 'qLeft'), ed('mMid', 'qMid'),
                 ed('qRight', 'merge'), ed('qLeft', 'merge'), ed('qMid', 'merge')];
  const laid = autoLayout(nodes, edges);
  assert(xOf(laid, 'merge') === xOf(laid, 'qRight'),
    `merge at ${xOf(laid, 'merge')}, first parent qRight at ${xOf(laid, 'qRight')}`);
});

test('a chain reading several documents hangs from the lowest of them', () => {
  const nodes = [file('f0', 0), file('f1', 900), file('f2', 1800), file('f3', 2700), file('f4', 3600), th('synth')];
  nodes[3].position.y = 400; // f3 hangs lowest
  const edges = ['f0', 'f1', 'f2', 'f3', 'f4'].map((f) => ed(f, 'synth'));
  const x = xOf(autoLayout(nodes, edges), 'synth');
  assert(Math.abs(x - (2700 - 60)) < 1, `synthesis at ${x}, not under the lowest document f3`);
});

test('a linked frame with members is untouched by auto layout, its members still laid out (#64)', () => {
  const original = frame('frame', 0, 400, 700, 900);
  const laid = autoLayout([
    original,
    placed(th('root'), 100, 500, 520, 260),
    placed(th('child'), 100, 900, 520, 260),
  ], [ed('root', 'child')]);
  const f = nodeOf(laid, 'frame'), root = nodeOf(laid, 'root'), child = nodeOf(laid, 'child');
  assert(f.position.x === original.position.x && f.position.y === original.position.y, 'linked frame moved');
  assert(f.width === original.width && f.height === original.height, 'linked frame resized');
  assert(child.position.y > root.position.y && child.position.x === root.position.x, 'child not laid out under its parent');
});

test('an unlinked frame is untouched by auto layout', () => {
  const original = frame('frame', 0, 400, 700, 900, false);
  const laid = autoLayout([
    original,
    placed(th('root'), 100, 500),
    placed(th('child'), 100, 900),
  ], [ed('root', 'child')]);
  const f = nodeOf(laid, 'frame');
  assert(f.position.x === original.position.x && f.position.y === original.position.y, 'unlinked frame moved');
  assert(f.width === original.width && f.height === original.height, 'unlinked frame resized');
});

test('a linked frame with no members is untouched by auto layout', () => {
  const original = frame('empty', 2000, 2000, 700, 900);
  const laid = autoLayout([original, placed(th('root'), 0, 0)], []);
  const f = nodeOf(laid, 'empty');
  assert(f.position.x === original.position.x && f.position.y === original.position.y, 'empty frame moved');
  assert(f.width === original.width && f.height === original.height, 'empty frame resized');
});

test('nested and overlapping frames are untouched by auto layout (#64)', () => {
  const originals = [
    frame('outer', 0, 400, 760, 1050),
    frame('inner', 50, 450, 660, 950),
    frame('leftFrame', 2000, 400, 650, 700),
    frame('rightFrame', 2150, 400, 650, 700),
  ];
  const laid = autoLayout([
    ...originals,
    placed(th('root'), 100, 500),
    placed(th('child'), 100, 900),
    placed(th('shared'), 2100, 500, 520, 120),
  ], [ed('root', 'child')]);
  for (const o of originals) {
    const f = nodeOf(laid, o.id);
    assert(f.position.x === o.position.x && f.position.y === o.position.y, `${o.id} moved`);
    assert(f.width === o.width && f.height === o.height, `${o.id} resized`);
  }
});

// #40: two linked frames that merely overlap must never own each other
test('a partially overlapping frame is not a member, its own nodes stay with it', () => {
  const F1 = frame('F1', 0, 0, 1000, 800);
  const F2 = frame('F2', 700, 500, 600, 500); // centre (1000, 750) inside F1, but not contained
  const a = placed(th('a'), 540, 540);        // centre (800, 600): inside both
  const far = placed(th('far'), 1000, 880);   // centre (1260, 940): inside F2 only
  const all = [F1, F2, a, far];
  const ids = (f) => frameMembers(f, all).map((n) => n.id).sort();
  assert(JSON.stringify(ids(F1)) === JSON.stringify(['a']), `F1 owns ${ids(F1)} (expected only a)`);
  assert(JSON.stringify(ids(F2)) === JSON.stringify(['a', 'far']), `F2 owns ${ids(F2)} (expected a, far)`);
});

test('a fully contained frame is a member of the outer frame, never the reverse', () => {
  const outer = frame('outer', 0, 0, 1000, 800);
  const inner = frame('inner', 100, 100, 400, 300);
  const n = placed(th('n'), 120, 120);
  const all = [outer, inner, n];
  const ids = (f) => frameMembers(f, all).map((x) => x.id).sort();
  assert(JSON.stringify(ids(outer)) === JSON.stringify(['inner', 'n']), `outer owns ${ids(outer)}`);
  assert(JSON.stringify(ids(inner)) === JSON.stringify(['n']), `inner owns ${ids(inner)}`);
});

test('auto layout leaves partially overlapping frames where they are (#64)', () => {
  const F1 = frame('F1', 0, 0, 1000, 800);
  const F2 = frame('F2', 700, 500, 600, 500);
  const laid = autoLayout([F1, F2, placed(th('a'), 540, 540, 520, 120), placed(th('far'), 1000, 880, 520, 120)], []);
  for (const o of [F1, F2]) {
    const f = nodeOf(laid, o.id);
    assert(f.position.x === o.position.x && f.position.y === o.position.y && f.width === o.width && f.height === o.height, `${o.id} changed`);
  }
});

test('the benchmark canvases keep the arrow order', () => {
  const dir = join(ROOT, 'benchmark/canvases/inputs');
  let checked = 0, bad = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.thoughtdag.json'))) {
    const c = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const v = violations(autoLayout(c.nodes ?? [], c.edges ?? []), c.edges ?? []);
    checked++;
    if (v.length) bad.push(`${f}: ${v[0]}`);
  }
  assert(checked > 0, 'no benchmark canvases found');
  assert(bad.length === 0, `${bad.length}/${checked} canvases violate: ${bad[0]}`);
});

rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} failing` : '\nall passed');
process.exit(failures ? 1 : 0);
