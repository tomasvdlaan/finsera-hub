import { createRequire } from 'node:module';
import { cpSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const require = createRequire(import.meta.url);

/**
 * Put Excalidraw's fonts where we serve them from, rather than where it would fetch them.
 *
 * Left alone, `@excalidraw/excalidraw` loads its fonts from unpkg.com at runtime. An internal
 * platform must not reach a public CDN to render a page — it breaks on a locked-down network,
 * it leaks which pages are open to whoever runs the CDN, and it makes the board's appearance
 * depend on somebody else's uptime. Copying the files in and pointing
 * `window.EXCALIDRAW_ASSET_PATH` at them is the supported way to opt out.
 */
function excalidrawAssets(): Plugin {
  return {
    name: 'excalidraw-assets',
    buildStart() {
      // Resolved from the package entry rather than from its package.json, which the
      // package's own `exports` map does not expose — asking for it is a hard error.
      const entry = require.resolve('@excalidraw/excalidraw');
      const from = resolve(dirname(entry), 'fonts');
      if (!existsSync(from)) {
        // Loud rather than silent: a missing font directory means the board renders in a
        // fallback face and nobody finds out until somebody mentions it looks odd.
        throw new Error(`Excalidraw fonts not found at ${from} — did the package layout change?`);
      }
      cpSync(from, resolve(import.meta.dirname, 'public/excalidraw-assets/fonts'), {
        recursive: true,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), excalidrawAssets()],
  /*
   * Excalidraw reads `process.env.IS_PREACT` at module scope, and in a Vite app `process` does
   * not exist — the board renders as a blank white page with no useful stack. This is the
   * documented shim, not a workaround.
   */
  define: { 'process.env.IS_PREACT': JSON.stringify('false') },
  build: {
    /*
     * No `manualChunks` for Excalidraw, and that is deliberate.
     *
     * The obvious defensive move is to pin everything matching `@excalidraw` into one named
     * chunk so a second importer cannot hoist the editor into the entry bundle. Doing that
     * makes things worse: Excalidraw ships its OWN dynamic imports — fonts, the mermaid
     * converter, image compression — and forcing every one of its modules into a single chunk
     * collapses that splitting and quadruples what a board costs to open.
     *
     * Rollup already does the right thing unaided, because `BoardEditor` is the only importer
     * of the package and it is reached through a `React.lazy`. `scripts/check-bundle.mjs`
     * asserts that it stays that way, which is the guarantee the manual rule was reaching for.
     */
    // The editor's chunk is legitimately large and is only fetched when a board is opened.
    // At the default limit this warning fires on every build, and a warning that always fires
    // stops being read.
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        // WebSocket upgrades are NOT proxied unless this is set, and the failure is
        // quiet: REST keeps working, so the page loads and shows data, while the live
        // socket silently never connects. That is exactly how the meeting transcript
        // came to update only on refresh.
        ws: true,
      },
    },
  },
});
