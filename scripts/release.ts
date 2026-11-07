import { readFileSync } from 'node:fs';
import { git, lines } from './git.ts';
import {
  assertDocumentation,
  assertLockVersion,
  assertVersion,
  branchNumber,
  latestVersion,
  parseSubject,
  releaseKind,
} from './policy.ts';

interface MergedEvent {
  pull_request: {
    base: { ref: string };
    body: string | null;
    head: { ref: string };
    merge_commit_sha: string;
    merged: boolean;
    number: number;
    title: string;
  };
  repository: { full_name: string };
}

const path = process.env.GITHUB_EVENT_PATH;
const token = process.env.GITHUB_TOKEN;

if (!path || !token) {
  throw new Error('Release runs only in the authenticated merged-PR workflow.');
}

const event = JSON.parse(readFileSync(path, 'utf8')) as MergedEvent;
const pr = event.pull_request;

if (!pr.merged || pr.base.ref !== 'main') {
  throw new Error('Only merged PRs targeting main can release.');
}

branchNumber(pr.head.ref);

parseSubject(pr.title);

const sha = git('rev-parse', 'HEAD');

if (
  sha !== pr.merge_commit_sha ||
  git('show', '-s', '--format=%s', sha) !== pr.title ||
  git('show', '-s', '--format=%P', sha).split(' ').length !== 1
) {
  throw new Error(
    'Release requires a squash merge whose commit subject exactly matches the validated PR title.',
  );
}

assertDocumentation(
  lines(git('diff-tree', '--no-commit-id', '--name-only', '-r', '--diff-filter=AMR', sha)),
);

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
const kind = releaseKind(pr.body ?? '');
const tag = `v${pkg.version}`;
const tags = lines(git('tag', '--list', 'v*'));
const exists = tags.includes(tag);

if (exists && git('rev-list', '-n', '1', tag) !== sha) {
  throw new Error(`${tag} already points to another commit; release tags are immutable.`);
}

const previous = latestVersion(lines(git('tag', '--merged', `${sha}^`, '--list', 'v*')));

assertVersion(pkg.version, previous, kind);

assertLockVersion(pkg.version, JSON.parse(readFileSync('package-lock.json', 'utf8')) as unknown);

if (!exists) {
  git('config', 'user.name', 'github-actions[bot]');

  git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');

  git('tag', '-a', tag, sha, '-m', `Release ${tag}`);

  git('push', 'origin', `refs/tags/${tag}`);
}

const url = `https://api.github.com/repos/${event.repository.full_name}/releases`;
const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
};
const existing = await fetch(`${url}/tags/${tag}`, { headers });

if (existing.status === 404) {
  const result = await fetch(url, {
    body: JSON.stringify({
      body: `Release ${kind} from #${pr.number}.\n\n${pr.body ?? ''}`,
      generate_release_notes: false,
      name: tag,
      tag_name: tag,
      target_commitish: sha,
    }),
    headers: { ...headers, 'Content-Type': 'application/json' },
    method: 'POST',
  });

  if (!result.ok) {
    throw new Error(`Release creation failed (${result.status}): ${await result.text()}`);
  }
} else if (!existing.ok) {
  throw new Error(`Release lookup failed (${existing.status}): ${await existing.text()}`);
}

console.log(`Published ${tag} at ${sha}.`);
