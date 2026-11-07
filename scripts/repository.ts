import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ReleaseKind } from './policy.ts';
import { git, lines } from './git.ts';
import {
  assertDocumentation,
  assertLockVersion,
  assertVersion,
  branchNumber,
  latestVersion,
  nextCommitNumber,
  nextVersion,
  parseSubject,
  readerId,
  releaseKind,
} from './policy.ts';

interface PullRequest {
  base: { ref: string; sha: string };
  body: string | null;
  head: { ref: string; sha: string };
  title: string;
}

interface GitHubEvent {
  pull_request?: PullRequest;
}

interface Sequence {
  lastBranch: number;
}

function parseSequence(value: unknown): Sequence {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('lastBranch' in value) ||
    typeof value.lastBranch !== 'number' ||
    !Number.isSafeInteger(value.lastBranch) ||
    value.lastBranch < 0
  ) {
    throw new Error('Invalid .reader-sequence.json.');
  }

  return { lastBranch: value.lastBranch };
}

function sequence(): Sequence {
  const value: unknown = JSON.parse(readFileSync('.reader-sequence.json', 'utf8'));

  return parseSequence(value);
}

function packageVersion(ref?: string): string {
  const raw = ref ? git('show', `${ref}:package.json`) : readFileSync('package.json', 'utf8');
  const value: unknown = JSON.parse(raw);

  if (
    typeof value !== 'object' ||
    value === null ||
    !('version' in value) ||
    typeof value.version !== 'string'
  ) {
    throw new Error('Missing package version.');
  }

  return value.version;
}

function prepareBranch(): void {
  if (git('status', '--porcelain')) {
    throw new Error('Start from a clean worktree; commit existing changes first.');
  }

  git('fetch', 'origin', 'main', '--tags');

  git('switch', 'main');

  git('pull', '--ff-only', 'origin', 'main');

  const refs = lines(
    git('for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'),
  );
  const numbers = refs
    .map((ref) => /(?:^|\/)reader-(\d{5})$/.exec(ref))
    .flatMap((match) => (match ? [Number(match[1])] : []));
  const next = Math.max(sequence().lastBranch, ...numbers) + 1;
  const branch = readerId(next);

  git('switch', '-c', branch);

  writeFileSync('.reader-sequence.json', `${JSON.stringify({ lastBranch: next }, null, 2)}\n`);

  console.log(
    `Created ${branch}. Commit the sequence file with your implementation and documentation.`,
  );
}

function checkStaged(): void {
  branchNumber(git('branch', '--show-current'));

  assertDocumentation(lines(git('diff', '--cached', '--name-only', '--diff-filter=AMR')));
}

function prepareVersion(kind: string | undefined): void {
  if (kind !== 'major' && kind !== 'minor' && kind !== 'patch') {
    throw new Error('Usage: npm run release:prepare -- major|minor|patch');
  }

  branchNumber(git('branch', '--show-current'));

  git('fetch', 'origin', '--tags');

  const version = nextVersion(latestVersion(lines(git('tag', '--list', 'v*'))), kind);
  const files = ['package.json', 'package-lock.json'];

  for (const file of files) {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));

    if (typeof value !== 'object' || value === null || !('version' in value)) {
      throw new Error(`Invalid ${file}.`);
    }

    value.version = version;

    if (
      file === 'package-lock.json' &&
      'packages' in value &&
      typeof value.packages === 'object' &&
      value.packages !== null &&
      '' in value.packages &&
      typeof value.packages[''] === 'object' &&
      value.packages[''] !== null &&
      'version' in value.packages['']
    ) {
      value.packages[''].version = version;
    }

    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  }

  console.log(
    `Prepared v${version} (${kind}). Update CHANGELOG.md and the PR checkbox before committing.`,
  );
}

function readPullRequest(): PullRequest {
  const path = process.env.GITHUB_EVENT_PATH;

  if (!path) {
    throw new Error('repo:check is a CI command and needs GITHUB_EVENT_PATH.');
  }

  // GitHub provides this event file; it is not user executable code.
  const event = JSON.parse(readFileSync(path, 'utf8')) as GitHubEvent;
  const pr = event.pull_request;

  if (!pr) {
    throw new Error('This command requires a pull_request event.');
  }

  return pr;
}

function checkPullRequest(): void {
  const pr = readPullRequest();

  if (pr.base.ref !== 'main') {
    throw new Error('PRs must target main.');
  }

  const featureNumber = branchNumber(pr.head.ref);
  const kind: ReleaseKind = releaseKind(pr.body ?? '');
  const hasSequence = git('ls-tree', '--name-only', pr.base.sha, '.reader-sequence.json') !== '';
  const baseSequence: unknown = hasSequence
    ? JSON.parse(git('show', `${pr.base.sha}:.reader-sequence.json`))
    : null;
  // The original initial commit predates the sequence ledger; only the first PR bootstraps it.
  const previousBranch = hasSequence ? parseSequence(baseSequence).lastBranch : 0;

  if (featureNumber <= previousBranch || sequence().lastBranch !== featureNumber) {
    throw new Error('Feature branch number must increase and match .reader-sequence.json.');
  }

  if (git('merge-base', pr.base.sha, pr.head.sha) !== pr.base.sha) {
    throw new Error('Update the feature branch onto current main before merging.');
  }

  const commits = lines(git('rev-list', '--reverse', `${pr.base.sha}..${pr.head.sha}`));
  const first = nextCommitNumber(lines(git('log', pr.base.sha, '--format=%s')));

  if (!commits.length || parseSubject(pr.title).number !== first) {
    throw new Error(`PR title must use ${readerId(first)} for the squash commit.`);
  }

  for (const [index, sha] of commits.entries()) {
    if (git('show', '-s', '--format=%P', sha).split(' ').length !== 1) {
      throw new Error('Use a linear feature history, not merge commits.');
    }

    const subject = parseSubject(git('show', '-s', '--format=%s', sha));

    if (subject.number !== first + index) {
      throw new Error(`Commit ${sha} must use ${readerId(first + index)}.`);
    }

    assertDocumentation(
      lines(git('diff-tree', '--no-commit-id', '--name-only', '-r', '--diff-filter=AMR', sha)),
    );
  }

  const previous = latestVersion(lines(git('tag', '--merged', pr.base.sha, '--list', 'v*')));

  assertVersion(packageVersion(), previous, kind);

  assertLockVersion(
    packageVersion(),
    JSON.parse(readFileSync('package-lock.json', 'utf8')) as unknown,
  );

  console.log(
    `PR policy passed: ${commits.length} commits, ${pr.head.ref}, ${kind}, v${packageVersion()}.`,
  );
}

function run(): void {
  const command = process.argv[2];

  if (command === 'branch') {
    prepareBranch();
  } else if (command === 'next') {
    console.log(readerId(nextCommitNumber(lines(git('log', 'HEAD', '--format=%s')))));
  } else if (command === 'staged') {
    checkStaged();
  } else if (command === 'version') {
    prepareVersion(process.argv[3]);
  } else if (command === 'pr') {
    checkPullRequest();
  } else {
    throw new Error('Unknown repository command.');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run();
}
