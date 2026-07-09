import { chmodSync, existsSync } from 'node:fs';

const cliPath = new URL('../dist/cli.js', import.meta.url);
if (existsSync(cliPath)) chmodSync(cliPath, 0o755);
