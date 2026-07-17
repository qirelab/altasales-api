import { execFileSync, spawnSync } from 'node:child_process';

const base = process.env.GITHUB_BASE_SHA
  ? process.env.GITHUB_BASE_SHA
  : process.env.GITHUB_BEFORE && !/^0+$/.test(process.env.GITHUB_BEFORE)
    ? process.env.GITHUB_BEFORE
    : `origin/${process.env.GITHUB_BASE_REF ?? 'develop'}`;

const changedFiles = execFileSync(
  'git',
  ['diff', '--name-only', `${base}...HEAD`, '--', 'src'],
  { encoding: 'utf8' },
)
  .split(/\r?\n/)
  .filter((file) => file.endsWith('.ts'));

if (changedFiles.length === 0) {
  process.exit(0);
}

const result = spawnSync(
  process.execPath,
  ['node_modules/eslint/bin/eslint.js', ...changedFiles],
  { stdio: 'inherit' },
);

if (result.error) {
  console.error(result.error);
}
process.exit(result.status ?? 1);
