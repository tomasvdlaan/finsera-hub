import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // 5173 belongs to the internal app. Two ports rather than two routes in one app: a
    // shared bundle would ship every internal component to a client's browser, and the
    // separation would be a router guard inside code they had already downloaded.
    port: 5174,
    proxy: {
      // Same-origin in development, so no CORS and no third place for a token to leak.
      // In production the portal is its own hostname and the reverse proxy does this.
      '/api': { target: 'http://localhost:3001' },
    },
  },
});
