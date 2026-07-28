import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
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
