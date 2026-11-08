import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import {
  deploymentRecord,
  deploymentUrl,
  integer,
  object,
  parseProof,
  text,
} from './deployment-policy.ts';
import { api, previousStable, required } from './deployment.ts';
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

if (
  process.env.GITHUB_EVENT_NAME !== 'push' ||
  process.env.GITHUB_REF !== 'refs/heads/main' ||
  !process.env.GITHUB_TOKEN
) {
  throw new Error('Release runs only on authenticated pushes to main.');
}

const sha = git('rev-parse', 'HEAD');

if (sha !== required('GITHUB_SHA')) {
  throw new Error('The checked-out commit does not match the main push event.');
}

const associatedPullRequests = await api(`/commits/${sha}/pulls`);

if (!Array.isArray(associatedPullRequests)) {
  throw new Error('GitHub did not return pull requests associated with the main commit.');
}

const mainPullRequests = associatedPullRequests
  .map(object)
  .filter((pullRequest) => object(pullRequest.base).ref === 'main');

if (mainPullRequests.length !== 1) {
  throw new Error('Main push must identify exactly one PR targeting main for this commit.');
}

const pullRequestNumber = integer(mainPullRequests[0].number);
const associatedPullRequest = object(await api(`/pulls/${pullRequestNumber}`));
const base = object(associatedPullRequest.base);
const head = object(associatedPullRequest.head);
const baseRepository = object(base.repo);
const headRepository = object(head.repo);
const repository = required('GITHUB_REPOSITORY');
const pr = {
  body: typeof associatedPullRequest.body === 'string' ? associatedPullRequest.body : null,
  branch: text(head.ref),
  head: text(head.sha),
  number: integer(associatedPullRequest.number),
  title: text(associatedPullRequest.title),
};

if (
  associatedPullRequest.merged !== true ||
  associatedPullRequest.merge_commit_sha !== sha ||
  base.ref !== 'main' ||
  baseRepository.full_name !== repository ||
  headRepository.full_name !== repository ||
  pr.head === sha
) {
  throw new Error('Release requires a merged same-repository PR targeting main.');
}

branchNumber(pr.branch);

parseSubject(pr.title);

if (
  ![pr.title, `${pr.title} (#${pr.number})`].includes(git('show', '-s', '--format=%s', sha)) ||
  git('show', '-s', '--format=%P', sha).split(' ').length !== 1
) {
  throw new Error(
    'Release requires the validated PR title, optionally followed by its exact GitHub PR-number suffix, on a squash merge.',
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

  deploymentUrl(required('DEPLOYMENT_URL'));

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
  const deployment = deploymentRecord(readFileSync(required('DEPLOYMENT_OUTPUT'), 'utf8'), 'test');
  const proof = {
    artifact: integer(Number(required('ARTIFACT_ID'))),
    attempt: integer(Number(required('GITHUB_RUN_ATTEMPT'))),
    branch: pr.branch,
    digest: `sha256:${required('ARTIFACT_DIGEST')}`,
    head: pr.head,
    pr: pr.number,
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
    `\n## TEST prerelease ${tag}\n\nDeployed to TEST; verify this exact version before PROD: ${deployment.url}\n`,
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
