// Gets the end-to-end test databases ready: separate from your own data in
// .wrangler/state, so test resets never touch it. The dictionary there is a
// small sample (test/fixtures/dict_sample.json), loaded again each time so a
// changed sample is picked up.
import { execSync } from 'node:child_process';

execSync('npx wrangler d1 migrations apply shiori --local --persist-to .wrangler/e2e', { stdio: 'inherit' });
execSync('npm run dict:load -- --json test/fixtures/dict_sample.json --persist-to .wrangler/e2e --fresh', { stdio: 'inherit' });
