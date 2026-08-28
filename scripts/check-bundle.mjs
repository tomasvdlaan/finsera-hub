#!/usr/bin/env node
/**
 * The board editor must not be in the chunk every page downloads.
 *
 * `@excalidraw/excalidraw` is the largest dependency in the app by a wide margin — a few
 * hundred kilobytes gzipped. It is kept out of the entry bundle by exactly one thing: that
 * `BoardEditor.tsx` is its only importer, and that file is reached through a `React.lazy` in
 * `BoardCanvas.tsx`. Nothing enforces that. One `import { Excalidraw } from …` in a route
 * component, or one eager import of `BoardEditor`, silently moves the whole editor into the
 * entry chunk and every page in the platform gets slower — with no error, no warning, and
 * nothing in review that looks wrong.
 *
 * So it is asserted against the built output rather than the source: this checks what actually
 * shipped, which is the only thing that can be wrong.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS = 'apps/web/dist/assets';
const INDEX = 'apps/web/dist/index.html';

if (!existsSync(ASSETS) || !existsSync(INDEX)) {
  console.error(`✖ no build to check — run \`pnpm build\` first (looked in ${ASSETS})`);
  process.exit(1);
}

/*
 * The entry is whatever index.html loads directly. Read rather than guessed: the filename
 * carries a content hash, and a guess would quietly check nothing once the hash changed.
 */
const html = readFileSync(INDEX, 'utf8');
const entries = [...html.matchAll(/src="\/assets\/([^"]+\.js)"/g)].map((m) => m[1]);

if (entries.length === 0) {
  console.error('✖ could not find an entry script in dist/index.html — has the build changed?');
  process.exit(1);
}

/** Strings that only Excalidraw's editor produces. Class names it renders, not our own. */
const FINGERPRINTS = ['excalidraw__canvas', 'App-toolbar', 'excalidraw-container'];

const offenders = entries.filter((name) => {
  const body = readFileSync(join(ASSETS, name), 'utf8');
  return FINGERPRINTS.some((f) => body.includes(f));
});

if (offenders.length > 0) {
  console.error(
    `✖ the Excalidraw editor is in the entry bundle (${offenders.join(', ')}).\n` +
      `  Every page now downloads it, not just /whiteboards/:id.\n` +
      `  Import it only from apps/web/src/modules/whiteboard/BoardEditor.tsx, which is\n` +
      `  reached lazily from BoardCanvas.tsx.`,
  );
  process.exit(1);
}

console.log(`✔ the board editor stays out of the entry bundle (${entries.length} entry chunk(s) checked)`);
