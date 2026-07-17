import { spawnSync } from 'node:child_process';
import { getChangedFiles } from './changed-files.mjs';

const changedFiles = getChangedFiles(['.ts', '.mjs', '.json', '.yml', '.yaml']);

if (changedFiles.length === 0) {
  process.exit(0);
}

const result = spawnSync(
  process.execPath,
  ['node_modules/prettier/bin/prettier.cjs', '--check', ...changedFiles],
  { stdio: 'inherit' },
);

if (result.error) {
  console.error(result.error);
}
process.exit(result.status ?? 1);
