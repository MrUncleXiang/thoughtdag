// What every host does around a run, in plain Node: the per-canvas
// workspace directory, the canvas's materials written where the agent can
// read them, the boundary guard's tuning file. Used by the desktop shell,
// the harness plugin host and the local server alike.
'use strict';
const path = require('node:path');
const fsp = require('node:fs/promises');

const WORKSPACE_ID = /^[\w.-]{1,80}$/;
const fileExists = (p) => fsp.access(p).then(() => true, () => false);

/** The shell-managed working directory of a canvas, created on demand. */
async function workspaceFor(root, canvasId) {
  if (!WORKSPACE_ID.test(String(canvasId))) throw new Error('bad canvas id');
  const dir = path.join(root, String(canvasId));
  await fsp.mkdir(dir, { recursive: true });
  const readme = path.join(dir, 'README.md');
  if (!(await fileExists(readme))) {
    await fsp.writeFile(readme, `# ThoughtDAG workspace\n\nThis folder is the working directory of one ThoughtDAG canvas (id ${canvasId}).\nAgents launched from that canvas read, write and run commands here unless the\ncanvas mirrors a session that already has a working directory of its own.\n`);
  }
  return dir;
}

/** The canvas's materials under <cwd>/.thoughtdag/materials/<name>:
 *  text as-is, binaries from base64. */
async function writeMaterials(cwd, files) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || !Array.isArray(files)) return { dir: null, written: [] };
  const dir = path.join(cwd, '.thoughtdag', 'materials');
  await fsp.mkdir(dir, { recursive: true });
  const written = [];
  for (const f of files.slice(0, 40)) {
    const name = String(f?.name ?? '').replace(/[/\\:*?"<>|]/g, '_').slice(0, 120);
    if (!name || typeof f.content !== 'string') continue;
    const target = path.join(dir, name);
    try {
      await fsp.writeFile(target, f.encoding === 'base64' ? Buffer.from(f.content, 'base64') : f.content);
      written.push(target);
    } catch { /* one bad file does not stop the rest */ }
  }
  return { dir, written };
}

/** The guard's tuning for a working directory: <cwd>/.thoughtdag/guard.json */
async function writeGuard(cwd, config) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return false;
  const dir = path.join(cwd, '.thoughtdag');
  await fsp.mkdir(dir, { recursive: true });
  const mode = config?.mode === 'allow' || config?.mode === 'auto' ? config.mode : 'ask';
  const allow = Array.isArray(config?.allow) ? config.allow.filter((x) => typeof x === 'string' && path.isAbsolute(x)).slice(0, 100) : [];
  await fsp.writeFile(path.join(dir, 'guard.json'), JSON.stringify({ mode, allow }, null, 2));
  return true;
}

module.exports = { workspaceFor, writeMaterials, writeGuard };
