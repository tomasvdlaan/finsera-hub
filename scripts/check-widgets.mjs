#!/usr/bin/env node
/**
 * Every widget a manifest declares must be a component the web app can render.
 *
 * `widgets[].component` is a string that crosses a package boundary: the backend declares it,
 * the frontend resolves it, and nothing between them checks that the two agree. That gap is
 * not hypothetical — six `entity-page` widgets were declared and none of them resolved,
 * because the registry meant to consume them was never written and the pages imported their
 * components directly instead. Nothing reported it for the life of the project.
 *
 * The reverse direction matters too. A widget registered on the web and declared by no
 * manifest is invisible: the module page will not list it, and the server cannot know it
 * exists to decide whether somebody is allowed to see it.
 *
 * A script rather than a test, for the same reason as check-routes.mjs: the two halves live
 * in different packages with different runners, and neither can import across the boundary.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const API = 'apps/api/src/modules';
const WEB = 'apps/web/src/modules';

/** `widgets: [{ slot: 'x', component: 'y' }]` out of every module manifest. */
function declared() {
  const found = [];
  for (const d of readdirSync(API, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const file = join(API, d.name, `${d.name}.manifest.ts`);
    let src;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const block = src.match(/widgets:\s*\[([\s\S]*?)\]/);
    if (!block) continue;
    for (const m of block[1].matchAll(/component:\s*'([^']+)'/g)) {
      found.push({ key: m[1], file });
    }
  }
  return found;
}

/**
 * Keys the web modules register, from each module's widgets.tsx.
 *
 * Read from the widget file rather than from index.ts, because index.ts registers by
 * reference — `widgets: scrumWidgets` — and a check that only understood an inline object
 * would pass by finding nothing, which is the worst way for a guard to fail.
 */
function registered() {
  const keys = new Set();
  for (const d of readdirSync(WEB, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    let src;
    try {
      src = readFileSync(join(WEB, d.name, 'widgets.tsx'), 'utf8');
    } catch {
      continue;
    }
    // Only the top-level keys of the exported record: two spaces of indentation, a quoted
    // `module:name`, a colon. A key nested inside a widget's own settings never matches.
    for (const m of src.matchAll(/^ {2}'([a-z-]+:[a-z0-9-]+)':/gm)) keys.add(m[1]);
  }
  return keys;
}

const have = registered();
const want = declared();

const missing = want.filter((w) => !have.has(w.key));
const orphans = [...have].filter((k) => !want.some((w) => w.key === k));

let bad = false;

if (missing.length > 0) {
  bad = true;
  console.error(`\n${missing.length} widget(s) declared by a manifest that nothing renders:\n`);
  for (const m of missing) console.error(`  ${m.key.padEnd(28)} ${m.file}`);
  console.error('\nRegister the component in that module\'s web index.ts under `widgets`.\n');
}

if (orphans.length > 0) {
  bad = true;
  console.error(`\n${orphans.length} widget(s) registered on the web and declared by no manifest:\n`);
  for (const k of orphans) console.error(`  ${k}`);
  console.error(
    '\nThe server cannot police a widget it does not know about, and the module page\n' +
      'will not list it. Add it to the module manifest\'s `widgets`.\n',
  );
}

if (bad) process.exit(1);
console.log(`✔ ${want.length} declared widgets all resolve, and none is unaccounted for`);
