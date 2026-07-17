import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const eventPayload =
  process.env.GITHUB_EVENT_PATH && existsSync(process.env.GITHUB_EVENT_PATH)
    ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
    : {};
const pullRequestBase = eventPayload.pull_request?.base?.sha;
const pushBefore = eventPayload.before;
const validPushBefore =
  pushBefore && !/^0+$/.test(pushBefore) ? pushBefore : undefined;
const base =
  process.env.GITHUB_BASE_SHA ??
  pullRequestBase ??
  validPushBefore ??
  `origin/${process.env.GITHUB_BASE_REF ?? 'develop'}`;

export function getChangedFiles(extensions) {
  return execFileSync('git', ['diff', '--name-only', `${base}...HEAD`, '--'], {
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .filter(
      (file) =>
        extensions.some((extension) => file.endsWith(extension)) &&
        existsSync(file),
    );
}
