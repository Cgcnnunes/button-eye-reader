import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { deploymentRecord, integer, object, parseProof, text } from './deployment-policy.ts';
import { api, previousStable, required, successfulValidation } from './deployment.ts';
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

if (!path || !process.env.GITHUB_TOKEN) {
  throw new Error('Release runs only in the authenticated merged-PR workflow.');
}

const event = JSON.parse(readFileSync(path, 'utf8')) as MergedEvent;
const pr = event.pull_request;

if (
  !pr.merged ||
  pr.base.ref !== 'main' ||
  event.repository.full_name !== required('GITHUB_REPOSITORY')
) {
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

if (exists && git('cat-file', '-t', `refs/tags/${tag}`) !== 'tag') {
  throw new Error('Existing release tag must be annotated.');
}

const previous = latestVersion(lines(git('tag', '--merged', `${sha}^`, '--list', 'v*')));

assertVersion(pkg.version, previous, kind);

assertLockVersion(pkg.version, JSON.parse(readFileSync('package-lock.json', 'utf8')) as unknown);

const command = process.argv[2];

if (command !== 'prepare' && command !== 'publish') {
  throw new Error('Release requires prepare before TEST or publish after successful TEST.');
}

if (command === 'prepare') {
  required('CLOUDFLARE_ACCOUNT_ID');

  required('CLOUDFLARE_API_TOKEN');

  await successfulValidation(sha, true);

  if (exists) {
    const existing = await api(`/releases/tags/${tag}`);

    if (existing !== null) {
      const release = object(existing);

      if (release.prerelease !== true || parseProof(release.body).sha !== sha) {
        throw new Error('Cannot retest an already stable or unrelated release tag.');
      }
    }
  }

  writeFileSync('dist/release.json', `${JSON.stringify({ sha, tag })}\n`);

  console.log(`Prepared ${tag} at ${sha} for TEST; no tag or release created.`);
} else {
  await successfulValidation(sha);

  const deployment = deploymentRecord(readFileSync(required('DEPLOYMENT_OUTPUT'), 'utf8'), 'test');
  const proof = {
    artifact: integer(Number(required('ARTIFACT_ID'))),
    attempt: integer(Number(required('GITHUB_RUN_ATTEMPT'))),
    digest: `sha256:${required('ARTIFACT_DIGEST')}`,
    run: integer(Number(required('GITHUB_RUN_ID'))),
    sha,
    ...deployment,
  };
  const metadata = `<!-- tested-deployment ${JSON.stringify(proof)} -->`;

  parseProof(metadata);

  const previousTag = await previousStable();
  const notes = object(
    await api('/releases/generate-notes', 'POST', {
      ...(previousTag ? { previous_tag_name: previousTag } : {}),
      tag_name: tag,
      target_commitish: sha,
    }),
  );
  const body = `${text(notes.body)}\n\nTEST: ${deployment.url}\n\n${metadata}`;
  const existing = await api(`/releases/tags/${tag}`);

  if (existing !== null) {
    const release = object(existing);

    if (release.prerelease !== true || parseProof(release.body).sha !== sha) {
      throw new Error('Existing release is stable or belongs to another TEST commit.');
    }
  }

  if (!exists) {
    git('config', 'user.name', 'github-actions[bot]');

    git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');

    git('tag', '-a', tag, sha, '-m', `Release ${tag}`);

    git('push', 'origin', `refs/tags/${tag}`);
  }

  appendFileSync(
    required('GITHUB_STEP_SUMMARY'),
    `\nPrerelease ${tag}: ${deployment.url}\n\nPROD requires Deploy to PROD dispatch with tag ${tag}.\n`,
  );

  await api(
    existing === null ? '/releases' : `/releases/${integer(object(existing).id)}`,
    existing === null ? 'POST' : 'PATCH',
    {
      body,
      make_latest: 'false',
      name: tag,
      prerelease: true,
      tag_name: tag,
      target_commitish: sha,
    },
  );

  console.log(`Published TEST prerelease ${tag} at ${sha}.`);
}
