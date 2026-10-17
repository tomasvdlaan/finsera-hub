import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './shell/App.js';
import { registerServiceWorker } from './shell/push.js';
/*
 * Self-hosted, not fetched from a CDN.
 *
 * The platform runs on a laptop in a meeting room as often as anywhere else, and a typeface
 * that arrives over the network is a typeface that is sometimes missing — which on a screen
 * this typographic is not a small degradation. It also keeps the app free of a third-party
 * request on every page load.
 */
import '@fontsource-variable/plus-jakarta-sans';
import './styles.css';
// After styles.css on purpose: the phone tier overrides it, and source order is how.
import './phone.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Push-only — no fetch handler, no cache (see public/sw.js). Registered on every load so a
// device that already allowed notifications keeps receiving them after an update.
void registerServiceWorker();
