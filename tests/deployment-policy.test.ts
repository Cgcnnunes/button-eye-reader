import { describe, expect, it } from 'vitest';
import {
  assertEvidence,
  assertMergedPullRequest,
  deploymentRecord,
  deploymentUrl,
  integer,
  object,
  parseProof,
  releaseTag,
  text,
} from '../scripts/deployment-policy.ts';

const sha = 'a'.repeat(40);
const proof = {
  artifact: 12,
  attempt: 1,
  branch: 'reader-00003',
  digest: `sha256:${'b'.repeat(64)}`,
  head: 'c'.repeat(40),
  pr: 3,
  run: 34,
  sha,
  url: 'https://button-eye-reader-test.example.workers.dev',
  version: '12345678-1234-1234-1234-123456789abc',
  worker: 'button-eye-reader-test',
};
const body = `Notes\n<!-- tested-deployment ${JSON.stringify(proof)} -->`;
const release = {
  body,
  draft: false,
  prerelease: true,
  tag_name: 'v0.1.1',
  target_commitish: sha,
};
const run = {
  conclusion: 'success',
  event: 'push',
  head_branch: 'main',
  head_sha: proof.sha,
  id: proof.run,
  path: '.github/workflows/deploy-to-test.yml',
  run_attempt: proof.attempt,
  status: 'completed',
};
const artifact = {
  digest: proof.digest,
  expired: false,
  id: proof.artifact,
  name: 'tested-site-34-1',
  workflow_run: { head_sha: proof.sha, id: proof.run },
};
const record = {
  targets: [proof.url],
  type: 'deploy',
  version_id: proof.version,
  worker_name: proof.worker,
  worker_name_overridden: false,
  wrangler_environment: 'test',
};

describe('deployment provenance and exact-tag promotion policy', () => {
  it('ties feature-run metadata to the actual merged PR and squash commit', () => {
    const pr = {
      base: { ref: 'main', repo: { full_name: 'example/reader' } },
      head: { ref: proof.branch, repo: { full_name: 'example/reader' }, sha: proof.head },
      merge_commit_sha: sha,
      merged: true,
      number: 3,
    };

    expect(() => {
      assertMergedPullRequest(pr, proof);
    }).not.toThrow();

    for (const change of [
      { merged: false },
      { merge_commit_sha: proof.head },
      { number: 4 },
      { base: { ...pr.base, ref: 'other' } },
      { head: { ...pr.head, sha } },
      { head: { ...pr.head, ref: 'reader-00004' } },
      { head: { ...pr.head, repo: { full_name: 'other/reader' } } },
    ]) {
      expect(() => {
        assertMergedPullRequest({ ...pr, ...change }, proof);
      }).toThrow();
    }
  });

  it('accepts only the successful TEST attempt and its immutable artifact', () => {
    expect(assertEvidence('v0.1.1', sha, release, run, artifact)).toEqual(proof);
  });

  it.each(['main', sha, 'v1.2', 'v01.2.3', 'v1.2.3-rc.1', 'v1.2.3\n', '--all'])(
    'rejects branch, SHA or malformed tag %s',
    (tag) => {
      expect(() => releaseTag(tag)).toThrow();
    },
  );

  it.each([null, [], true, 1])('rejects invalid metadata objects %j', (value) => {
    expect(() => object(value)).toThrow();
  });

  it('requires typed nonempty strings and positive safe integers', () => {
    expect(object({ a: 1 })).toEqual({ a: 1 });

    expect(text('valid')).toBe('valid');

    expect(integer(1)).toBe(1);

    for (const value of [null, '', 1]) {
      expect(() => text(value)).toThrow();
    }

    for (const value of ['1', 0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => integer(value)).toThrow();
    }
  });

  it.each([
    'http://test.example.workers.dev',
    'https://example.com',
    'https://workers.dev',
    'https://test.example.workers.dev/path',
    'https://test.example.workers.dev?x=1',
    'https://test.example.workers.dev#x',
    'https://user@test.example.workers.dev',
    'https://user:secret@test.example.workers.dev',
  ])('rejects unsafe or non-root deployment URL %s', (url) => {
    expect(() => deploymentUrl(url)).toThrow();
  });

  it('rejects missing, duplicated, malformed and forged provenance', () => {
    for (const value of ['Notes', `${body}\n${body}`, '<!-- tested-deployment {invalid} -->']) {
      expect(() => parseProof(value)).toThrow();
    }

    for (const change of [
      { digest: 'b'.repeat(64) },
      { sha: 'main' },
      { version: 'unknown' },
      { worker: 'button-eye-reader' },
    ]) {
      expect(() =>
        parseProof(`<!-- tested-deployment ${JSON.stringify({ ...proof, ...change })} -->`),
      ).toThrow();
    }
  });

  it.each([
    { draft: true },
    { prerelease: false },
    { tag_name: 'v0.1.2' },
    { target_commitish: 'main' },
    { body: body.replace(sha, 'c'.repeat(40)) },
  ])('rejects untested or already stable release metadata %j', (change) => {
    expect(() => assertEvidence('v0.1.1', sha, { ...release, ...change }, run, artifact)).toThrow();
  });

  it.each([
    { conclusion: 'failure' },
    { event: 'pull_request' },
    { head_branch: proof.branch },
    { head_branch: 'reader-00002' },
    { head_sha: 'd'.repeat(40) },
    { id: 99 },
    { path: '.github/workflows/execute-pr-validation.yml' },
    { run_attempt: 2 },
    { status: 'in_progress' },
  ])('rejects a failed, unrelated or changed TEST workflow %j', (change) => {
    expect(() => assertEvidence('v0.1.1', sha, release, { ...run, ...change }, artifact)).toThrow();
  });

  it.each([
    { digest: `sha256:${'c'.repeat(64)}` },
    { expired: true },
    { id: 99 },
    { name: 'other' },
    { workflow_run: { head_sha: sha, id: 99 } },
    { workflow_run: { head_sha: 'd'.repeat(40), id: proof.run } },
  ])('rejects replaced or expired TEST artifacts %j', (change) => {
    expect(() => assertEvidence('v0.1.1', sha, release, run, { ...artifact, ...change })).toThrow();
  });

  it('parses machine-readable TEST and PROD deployment records', () => {
    expect(
      deploymentRecord(`${JSON.stringify({ type: 'other' })}\n${JSON.stringify(record)}`, 'test'),
    ).toEqual({ url: proof.url, version: proof.version, worker: proof.worker });

    expect(
      deploymentRecord(
        JSON.stringify({
          ...record,
          targets: ['https://button-eye-reader-prod.example.workers.dev'],
          worker_name: 'button-eye-reader-prod',
          wrangler_environment: 'production',
        }),
        'production',
      ).worker,
    ).toBe('button-eye-reader-prod');
  });

  it('rejects missing, duplicate and wrong-environment deployment output', () => {
    expect(() => deploymentRecord('', 'test')).toThrow();

    expect(() =>
      deploymentRecord(`${JSON.stringify(record)}\n${JSON.stringify(record)}`, 'test'),
    ).toThrow();

    expect(() => deploymentRecord(JSON.stringify(record), 'other')).toThrow();

    for (const change of [
      { version_id: 'unknown' },
      { worker_name: 'button-eye-reader' },
      { worker_name_overridden: true },
      { wrangler_environment: 'production' },
      { targets: null },
      { targets: [1, 'https://example.com'] },
      { targets: [proof.url, proof.url] },
    ]) {
      expect(() => deploymentRecord(JSON.stringify({ ...record, ...change }), 'test')).toThrow();
    }

    expect(() =>
      deploymentRecord(
        JSON.stringify({
          ...record,
          targets: ['https://button-eye-reader-prod.example.workers.dev'],
          worker_name: 'button-eye-reader',
          wrangler_environment: 'production',
        }),
        'production',
      ),
    ).toThrow();
  });
});
