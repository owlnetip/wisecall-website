import { inject, track } from '@vercel/analytics';
import { initSiteMeasurement } from './site-measurement.ts';

// Official Vercel Web Analytics for Vite/static multi-page sites.
// Injected once per page via the Vite HTML transform (see vite.config.ts).
// Custom events and first-touch trial links live in the same entry so every
// HTML page gets one shared script, not per-page inline code.
inject();
initSiteMeasurement({ track });
