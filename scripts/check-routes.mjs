#!/usr/bin/env node
/**
 * Every URL the backend advertises must be a page the frontend serves.
 *
 * `entities[].urlPattern` is not documentation — it is written into `core.entities.urlPath` on
 * every row, and the timeline, the link picker, search and the assistant's citations all
 * navigate straight to that stored string. A pattern with no route behind it is a record that
 * is findable, mentionable, and lands on "not found" when you click it. Nothing tells you;
 * that is what this is for.
 *
 * Deliberately a script rather than a test. The two halves live in different packages with
 * different test runners, and the check is a string comparison across a boundary neither side
 * can import across.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Every file under a directory, recursively. */
function* walk(dir) {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, d.name);
    if (d.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const API = 'apps/api/src';
const WEB = 'apps/web/src';

/** Every `path:` and `urlPattern:` a manifest declares. */
function declared() {
  const found = [];
  const files = [
    ...readdirSync(join(API, 'modules'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(API, 'modules', d.name, `${d.name}.manifest.ts`)),
    join(API, 'shell', 'shell.manifest.ts'),
  ];
  for (const file of files) {
    let src;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const m of src.matchAll(/(?:urlPattern|path):\s*'(\/[^']*)'/g)) {
      found.push({ url: m[1], file });
    }
  }
  return found;
}

/** Every route the web app actually renders, from the module tables and the shell. */
function served() {
  const routes = new Set();
  const add = (src) => {
    for (const m of src.matchAll(/path:\s*'(\/[^']*)'/g)) routes.add(m[1]);
    for (const m of src.matchAll(/<Route path="([^"]+)"/g)) routes.add(m[1]);
  };
  for (const d of readdirSync(join(WEB, 'modules'), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    try {
      add(readFileSync(join(WEB, 'modules', d.name, 'index.ts'), 'utf8'));
    } catch {
      /* a module without a route table is fine */
    }
  }
  add(readFileSync(join(WEB, 'shell', 'App.tsx'), 'utf8'));
  return routes;
}

/** `:id` matches `:id`, `:noteId`, and so on — the parameter's name is not part of the URL. */
const shape = (url) => url.replace(/:[A-Za-z0-9_]+/g, ':x');

const routes = new Set([...served()].map(shape));
const orphans = declared().filter((d) => !routes.has(shape(d.url)));

/**
 * A redirect to a route nobody serves is worse than no redirect — it turns a broken link into
 * a broken link that took an extra hop to break. Checked here rather than in a web unit test
 * because reaching the route tables from a test means importing every page in the app.
 */
const moved = readFileSync(join(WEB, 'shell', 'moved.tsx'), 'utf8');
const targets = [...moved.matchAll(/\['(\/[^']*)', *'(\/[^']*)'\]/g)];
if (targets.length === 0) {
  console.error('\nmoved.tsx parsed to zero redirects — the MOVED table changed shape.\n');
  process.exit(1);
}
// `/scrum/tasks` -> `/tasks` is a prefix rule: neither side is a page, and its whole job is
// to carry `/scrum/tasks/abc` across. It passes if something lives *under* the target.
const covers = (to) =>
  routes.has(shape(to)) || [...routes].some((r) => r.startsWith(`${to}/`));
const dangling = targets.filter(([, , to]) => !covers(to));
if (dangling.length > 0) {
  console.error(`\n${dangling.length} redirect target(s) with no route behind them:\n`);
  for (const [, from, to] of dangling) console.error(`  ${from.padEnd(24)} -> ${to}`);
  console.error('');
  process.exit(1);
}

if (orphans.length > 0) {
  console.error(
    `\n${orphans.length} URL${orphans.length === 1 ? '' : 's'} declared by a manifest with no route behind ${orphans.length === 1 ? 'it' : 'them'}:\n`,
  );
  for (const o of orphans) console.error(`  ${o.url.padEnd(28)} ${o.file}`);
  console.error(
    '\nEach of these is written into core.entities.urlPath and is reachable from search,\n' +
      'the timeline, the link picker and the assistant. Clicking one lands on "not found".\n',
  );
  process.exit(1);
}

/**
 * No new source may spell a retired URL.
 *
 * The redirects exist for links already out in the world — stored `url_path` rows, bookmarks,
 * text the assistant has already written. A freshly typed `/crm/clients/${id}` works too, which
 * is the problem: it takes an extra hop for no reason and it keeps the retired prefix alive
 * long past the point where the redirect can be deleted.
 *
 * Only navigation syntax is checked. The API endpoints share these spellings and did not move,
 * so `api.get('/crm/clients')` is correct and must not be flagged — the difference is not in
 * the string, it is in who consumes it, and these contexts are where the browser does.
 */
const NAV_SYNTAX = [
  /\bto="(\/[^"]*)/g,
  /\bto=\{`(\/[^`]*)/g,
  /\bto: `(\/[^`]*)/g,
  /\bto: '(\/[^']*)/g,
  /\bhref="(\/[^"]*)/g,
  /\bnavigate\(['`](\/[^'`]*)/g,
  /\bpath: '(\/[^']*)/g,
  /<Route path="(\/[^"]*)/g,
  /\burlPattern: '(\/[^']*)/g,
  /\burlPath: ['`](\/[^'`]*)/g,
  /\breturn ['`](\/[^'`]*)/g,
];
const retired = targets.map(([, from]) => from);
const sins = [];
for (const [dir, exts] of [
  [WEB, ['.ts', '.tsx']],
  [API, ['.ts']],
]) {
  for (const file of walk(dir)) {
    if (!exts.some((e) => file.endsWith(e))) continue;
    if (file.includes('moved.')) continue; // the map itself, and its test
    const src = readFileSync(file, 'utf8');
    for (const rx of NAV_SYNTAX) {
      for (const m of src.matchAll(rx)) {
        const hit = retired.find((r) => m[1] === r || m[1].startsWith(`${r}/`) || m[1].startsWith(`${r}?`));
        if (hit) sins.push(`  ${file}: ${m[1]}`);
      }
    }
  }
}
if (sins.length > 0) {
  console.error(`\n${sins.length} navigation link(s) still spelling a retired URL:\n`);
  for (const s of sins) console.error(s);
  console.error('\nSee apps/web/src/shell/moved.tsx for where each one went.\n');
  process.exit(1);
}

console.log(
  `✔ every declared URL has a route, and no link spells a retired one (${routes.size} routes checked)`,
);
