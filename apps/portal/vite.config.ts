import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    /*
     * Bound on every interface, so `<slug>.localhost` works whichever way it resolves.
     *
     * Vite's default binds one loopback stack. `dochorse.localhost` resolves to both `::1`
     * and `127.0.0.1`, and a browser is free to try either — so the portal was reachable or
     * not depending on which one it picked, which reads as "the site is down" and is
     * nothing of the sort. Development only; this file is not used for anything deployed.
     */
    host: true,
    /*
     * Every client portal is a subdomain of the dev host, and Vite refuses hosts it does not
     * know about (its defence against DNS rebinding). Naming the suffix admits `duce`,
     * `dochorse` and whatever is added next without listing clients in a config file.
     */
    allowedHosts: ['localhost', '.localhost'],
    // 5173 belongs to the internal app. Two ports rather than two routes in one app: a
    // shared bundle would ship every internal component to a client's browser, and the
    // separation would be a router guard inside code they had already downloaded.
    port: 5174,
    proxy: {
      // Same-origin in development, so no CORS and the session cookie is first-party. The
      // Host header is passed through unchanged, which is how the API knows this is
      // `localhost:5174` (PORTAL_AUTH_HOST) or `<slug>.localhost:5174` (a client host).
      // In production the API serves this bundle itself on the portal hosts (Phase 8 §4.3).
      '/api': { target: 'http://localhost:3001' },

      /*
       * Custom content, which in production never comes near this server.
       *
       * There, Caddy hands a portal host's whole path space to the API, which decides per
       * request whether a path is a page the client was given or a route in this app —
       * something only the database can answer. Here, this dev server owns the origin and
       * forwards nothing but `/api`, so `/rapportage-q3/` was answered with index.html and
       * the app, finding no such route, sent the visitor to the front page. The feature
       * looked broken and was not: the request never left Vite.
       *
       * So anything that is not this app's own is forwarded. The excluded list is the
       * app's routes plus Vite's own dev paths; a page may not be called any of them,
       * which `PortalPagesService` already enforces with the same list. A key beginning
       * with `^` is a regular expression to Vite.
       */
      '^/(?!$|api/|auth/|src/|@|node_modules/|favicon|assets/|projecten|taken|offertes|facturen|documenten|rapporten|vragen)':
        { target: 'http://localhost:3001' },
    },
  },
});
