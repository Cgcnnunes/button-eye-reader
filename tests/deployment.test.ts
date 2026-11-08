import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, download, previousStable, promote, smoke, validate } from '../scripts/deployment.ts';

const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  exec: vi.fn(),
  exists: vi.fn(() => false),
  git: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
}));

vi.mock('node:child_process', () => ({ execFileSync: mocks.exec }));

vi.mock('node:fs', () => ({
  appendFileSync: mocks.append,
  existsSync: mocks.exists,
  readFileSync: mocks.read,
  writeFileSync: mocks.write,
}));

vi.mock('../scripts/git.ts', () => ({ git: mocks.git }));

const sha = 'a'.repeat(40);
const archive = Buffer.from('Immutable zip fixture');
const proof = {
  artifact: 12,
  attempt: 1,
  digest: `sha256:${createHash('sha256').update(archive).digest('hex')}`,
  run: 34,
  sha,
  url: 'https://button-eye-reader-test.example.workers.dev',
  version: '12345678-1234-1234-1234-123456789abc',
  worker: 'button-eye-reader-test',
};
const release = {
  body: `Notes\n<!-- tested-deployment ${JSON.stringify(proof)} -->`,
  draft: false,
  id: 56,
  prerelease: true,
  tag_name: 'v0.1.1',
  target_commitish: sha,
};
const run = {
  conclusion: 'success',
  event: 'pull_request',
  head_branch: 'main',
  head_sha: sha,
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
  workflow_run: { head_sha: sha, id: proof.run },
};
const marker = `${JSON.stringify({ sha, tag: 'v0.1.1' })}\n`;

function reply(path: string): Response {
  if (path.includes('/releases/tags/')) {
    return Response.json(release);
  }

  if (path.endsWith('/actions/runs/34')) {
    return Response.json(run);
  }

  if (path.endsWith('/actions/artifacts/12')) {
    return Response.json(artifact);
  }

  if (path.endsWith('/actions/artifacts/12/zip')) {
    return new Response(archive);
  }

  if (path.endsWith('/releases/latest')) {
    return Response.json({ draft: false, prerelease: false, tag_name: 'v0.1.0' });
  }

  return Response.json({ id: 56 });
}

describe('deployment API, artifact and promotion orchestration', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    vi.unstubAllEnvs();

    vi.stubEnv('GITHUB_TOKEN', 'test-token');

    vi.stubEnv('GITHUB_REPOSITORY', 'example/reader');

    vi.stubEnv('RELEASE_TAG', 'v0.1.1');

    vi.stubEnv('GITHUB_EVENT_NAME', 'workflow_dispatch');

    vi.stubEnv('GITHUB_REF', 'refs/heads/main');

    vi.stubEnv('TEST_APPROVED', 'true');

    vi.stubEnv('EXPECTED_SHA', sha);

    vi.stubEnv('EXPECTED_ARTIFACT', '12');

    vi.stubEnv('EXPECTED_DIGEST', proof.digest);

    vi.stubEnv('RUNNER_TEMP', 'temporary');

    mocks.git.mockImplementation((...args: string[]) => {
      if (args[0] === 'cat-file') {
        return 'tag';
      }

      if (args[0] === 'rev-parse') {
        return sha;
      }

      if (args[0] === 'show') {
        return args[1].endsWith(':package.json')
          ? JSON.stringify({ version: '0.1.1' })
          : JSON.stringify({ packages: { '': { version: '0.1.1' } }, version: '0.1.1' });
      }

      return '';
    });

    mocks.exists.mockReturnValue(false);

    mocks.read.mockReturnValue(marker);

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => Promise.resolve(reply(url))),
    );
  });

  it('validates tag ancestry, package version, successful TEST run and artifact independently', async () => {
    expect((await validate()).proof).toEqual(proof);

    expect(mocks.git).toHaveBeenCalledWith('merge-base', '--is-ancestor', sha, 'origin/main');

    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) => typeof url === 'string' && url.includes('/actions/workflows/')),
    ).toBe(false);
  });

  it('requires explicit human acceptance and dispatch from the trusted main workflow', async () => {
    vi.stubEnv('TEST_APPROVED', 'false');

    await expect(validate()).rejects.toThrow('explicit acceptance');

    vi.stubEnv('TEST_APPROVED', 'true');

    vi.stubEnv('GITHUB_REF', 'refs/tags/v0.1.1');

    await expect(validate()).rejects.toThrow('dispatch from main');
  });

  it('rejects lightweight tags and version disagreement before deployment', async () => {
    mocks.git.mockImplementation((...args: string[]) => (args[0] === 'cat-file' ? 'commit' : sha));

    await expect(validate()).rejects.toThrow('annotated');
  });

  it('rejects same-version and downgrade promotions', async () => {
    for (const tag of ['v0.1.1', 'v0.2.0']) {
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) =>
          Promise.resolve(
            url.endsWith('/releases/latest')
              ? Response.json({ draft: false, prerelease: false, tag_name: tag })
              : reply(url),
          ),
        ),
      );

      await expect(validate()).rejects.toThrow('move forward');
    }
  });

  it('downloads and checks the exact zip digest without rebuilding', async () => {
    await download();

    expect(mocks.write).toHaveBeenCalledWith(expect.stringContaining('tested-site.zip'), archive);

    expect(mocks.exec).toHaveBeenCalledWith(
      'unzip',
      ['-q', expect.stringContaining('tested-site.zip'), '-d', 'dist'],
      { stdio: 'inherit' },
    );
  });

  it('rejects changed provenance during approval and existing dist', async () => {
    vi.stubEnv('EXPECTED_ARTIFACT', '99');

    await expect(download()).rejects.toThrow('changed during approval');

    vi.stubEnv('EXPECTED_ARTIFACT', '12');

    mocks.exists.mockReturnValue(true);

    await expect(download()).rejects.toThrow('without dist');
  });

  it('rejects failed downloads and checksum or marker mismatches', async () => {
    for (const response of [new Response('no', { status: 403 }), new Response('tampered zip')]) {
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => Promise.resolve(url.endsWith('/zip') ? response : reply(url))),
      );

      await expect(download()).rejects.toThrow();

      expect(mocks.exec).not.toHaveBeenCalled();
    }

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => Promise.resolve(reply(url))),
    );

    mocks.read.mockReturnValue(JSON.stringify({ sha: 'other', tag: 'v0.1.1' }));

    await expect(download()).rejects.toThrow('does not identify');
  });

  it('promotes the same release without moving or creating tags', async () => {
    await promote();

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/releases/56'),
      expect.objectContaining({
        body: JSON.stringify({ make_latest: 'true', prerelease: false }),
        method: 'PATCH',
      }),
    );

    expect(mocks.git.mock.calls.some((args) => args[0] === 'tag')).toBe(false);
  });

  it('handles first release absence explicitly and propagates API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 404 }))),
    );

    expect(await previousStable()).toBeUndefined();

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('Denied', { status: 403 }))),
    );

    await expect(api('/releases')).rejects.toThrow('403');

    vi.stubEnv('GITHUB_REPOSITORY', '../invalid');

    await expect(api('/releases')).rejects.toThrow('repository');
  });

  it('blocks failed, missing and unrelated TEST runs', async () => {
    for (const data of [
      null,
      {},
      { ...run, conclusion: 'failure' },
      { ...run, head_sha: 'other' },
      { ...run, status: 'in_progress' },
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) =>
          Promise.resolve(url.endsWith('/actions/runs/34') ? Response.json(data) : reply(url)),
        ),
      );

      await expect(validate()).rejects.toThrow();
    }
  });

  it('checks the public marker, exact asset bytes, WASM MIME and security headers', async () => {
    vi.stubEnv('DEPLOYMENT_URL', proof.url);

    vi.stubEnv('DEPLOYMENT_OUTPUT', 'deploy.jsonl');

    const record = JSON.stringify({
      targets: [proof.url],
      type: 'deploy',
      version_id: proof.version,
      worker_name: proof.worker,
      worker_name_overridden: false,
      wrangler_environment: 'test',
    });

    mocks.read.mockImplementation((path: string, encoding?: string) => {
      if (path === 'deploy.jsonl') {
        return record;
      }

      return encoding ? marker : Buffer.from(marker);
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(marker, {
            headers: {
              'content-security-policy': "frame-ancestors 'none'",
              'content-type': 'application/wasm',
              'permissions-policy': 'camera=(self), microphone=(), geolocation=()',
            },
          }),
        ),
      ),
    );

    await smoke('test');

    expect(fetch).toHaveBeenCalledTimes(6);

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(marker))),
    );

    await expect(smoke('test')).rejects.toThrow('security headers');

    vi.stubEnv('DEPLOYMENT_URL', 'https://other.example.workers.dev');

    await expect(smoke('test')).rejects.toThrow('does not match');
  });
});
