import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './shell/App.js';
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
