// Gets the end-to-end test database ready: separate from your own data in
// .wrangler/state, so test resets never touch it.
import { execSync } from 'node:child_process';

execSync('npx wrangler d1 migrations apply shiori --local --persist-to .wrangler/e2e', { stdio: 'inherit' });
