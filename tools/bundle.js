#!/usr/bin/env node
// Bundle the ES module graph into one self-contained HTML file.
//
// The game normally runs as 29 native ES modules served over HTTP, which is the
// nicer way to develop. But a single file can be opened from disk, emailed, or
// hosted anywhere with no server at all -- so this walks the import graph,
// topologically sorts it, strips the module syntax and concatenates everything
// into one scope inside an IIFE.
//
// That only works because every module in this project uses plain single-line
// named imports and no default exports. The collision check below enforces the
// other requirement -- that no two modules declare the same top-level name --
// and fails loudly rather than emitting a subtly broken bundle.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = resolve(ROOT, 'src/main.js');
const OUT = resolve(ROOT, 'dist/omni.html');

const IMPORT_RE = /^import\s+\{([^}]*)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm;
const DECL_RE = /^(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;

/** Depth-first walk of the import graph, emitting dependencies before dependents. */
async function collect(file, seen = new Set(), order = []) {
  const key = resolve(file);
  if (seen.has(key)) return order;
  seen.add(key);

  const source = await readFile(key, 'utf8');
  const deps = [...source.matchAll(IMPORT_RE)].map((m) => m[2]);
  for (const spec of deps) {
    if (!spec.startsWith('.')) throw new Error(`bare import "${spec}" in ${key} -- not bundleable`);
    await collect(resolve(dirname(key), spec), seen, order);
  }
  order.push({ path: key, source });
  return order;
}

/** Remove import statements and the `export` keyword, keeping declarations intact. */
function stripModuleSyntax(source) {
  return source
    .replace(IMPORT_RE, '')
    .replace(/^export\s+(?=(?:const|let|var|function|class|async)\b)/gm, '')
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, '');
}

const modules = await collect(ENTRY);

// Guard the one assumption concatenation makes: unique top-level names.
const owners = new Map();
const clashes = [];
for (const m of modules) {
  const rel = relative(ROOT, m.path);
  for (const match of m.source.matchAll(DECL_RE)) {
    const name = match[1];
    if (owners.has(name)) clashes.push(`${name}: ${owners.get(name)} vs ${rel}`);
    else owners.set(name, rel);
  }
}
if (clashes.length) {
  console.error('Top-level name collisions would break the bundle:\n  ' + clashes.join('\n  '));
  process.exit(1);
}

const js = modules
  .map((m) => `\n// ===== ${relative(ROOT, m.path)} =====\n${stripModuleSyntax(m.source).trim()}\n`)
  .join('\n');

// Compile (without running) to catch anything the name check above misses --
// duplicate declarations across the shared bundle scope are a parse error that
// silently takes out the entire script, so it is worth failing the build here
// rather than shipping a blank page.
try {
  new Function(js);
} catch (err) {
  console.error(`bundle does not parse: ${err.message}`);
  process.exit(1);
}

const css = await readFile(resolve(ROOT, 'style.css'), 'utf8');

// The page deliberately commits to the game's own visual world -- the canvas
// paints every pixel, so there is no HTML chrome and no light theme. Every
// colour is still declared explicitly so the page holds on any host background
// rather than borrowing one.
const html = `<title>The Grand Frontier: Omni</title>
<style>
${css.trim()}
/* Bundled build: the canvas owns the whole viewport, including inside a frame. */
html, body { margin: 0; padding: 0; overflow: hidden; background: #080a12; }
#game {
  position: fixed; inset: 0; width: 100vw; height: 100vh; display: block;
  background: #080a12;
}
/* Focus is functional here, not decorative: without it the keyboard is dead. */
#game:focus-visible { outline: 2px solid #39e6ff; outline-offset: -2px; }
</style>

<canvas id="game" tabindex="0" aria-label="The Grand Frontier: Omni - a physics sandbox action game played with WASD and the mouse"></canvas>

<script>
(function () {
'use strict';
${js}

// When this page is embedded in a frame, key events go to whatever holds focus
// -- which is the parent document until something here takes it. Without this
// the mouse works and WASD silently does nothing, which reads as a broken game.
//
// Kept in its own scope: the bundle shares one function scope with every
// module, so a bare declaration here can collide with a module's top-level
// name and take the whole script out at parse time.
(function () {
  var el = document.getElementById('game');
  el.addEventListener('pointerdown', function () { el.focus(); });
  window.addEventListener('load', function () { el.focus(); });
  el.focus();
})();
})();
</script>
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html);

const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log(`bundled ${modules.length} modules -> ${relative(ROOT, OUT)} (${kb} KB)`);
console.log(`order: ${modules.map((m) => relative(ROOT, m.path)).join(' -> ')}`);
