/**
 * Entry point – Connect 5 Impossible
 * Bootstraps the application once the DOM is ready.
 */

import { initApp } from './ui/app.js';

// Vite injects CSS via the import below (processed at build time).
import './style.css';

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});
