// Gets the local database ready for end-to-end tests.
import { copyFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

if (!existsSync('.dev.vars')) copyFileSync('.dev.vars.example', '.dev.vars');
execSync('npx wrangler d1 migrations apply shiori --local', { stdio: 'inherit' });
