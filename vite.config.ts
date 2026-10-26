import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

// End-to-end tests run against their own database, apart from the one you
// study from, and only there are the /api/test endpoints on (reset, time
// travel, a nightly backup run). Its R2 copies stay in .wrangler/e2e too.
const e2e = process.env.SHIORI_E2E === '1';

export default defineConfig({
  plugins: [
    react(),
    cloudflare(
      e2e
        ? { persistState: { path: '.wrangler/e2e' }, config: (c) => ({ vars: { ...c.vars, ALLOW_TEST_ENDPOINTS: '1' } }) }
        : undefined,
    ),
  ],
});
