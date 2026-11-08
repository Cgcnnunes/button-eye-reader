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
  branch: 'reader-00003',
  digest: `sha256:${createHash('sha256').update(archive).digest('hex')}`,
  head: 'c'.repeat(40),
  pr: 3,
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
const marker = `${JSON.stringify({ sha, tag: 'v0.1.1' })}\n`;

function reply(path: string): Response {
  if (path.endsWith('/pulls/3')) {
    return Response.json({
      base: { ref: 'main', repo: { full_name: 'example/reader' } },
      head: { ref: proof.branch, repo: { full_name: 'example/reader' }, sha: proof.head },
      merge_commit_sha: sha,
      merged: true,
      number: 3,
    });
  }

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

function configureSmoke(environment = 'test'): void {
  const url =
    environment === 'test' ? proof.url : 'https://button-eye-reader-prod.example.workers.dev';

  vi.stubEnv('DEPLOYMENT_URL', url);

  vi.stubEnv('DEPLOYMENT_OUTPUT', 'deploy.jsonl');

  vi.stubEnv('CLOUDFLARE_ACCESS_CLIENT_ID', 'test-access-id');

  vi.stubEnv('CLOUDFLARE_ACCESS_CLIENT_SECRET', 'test-access-secret');

  const record = JSON.stringify({
    targets: [url],
    type: 'deploy',
    version_id: proof.version,
    worker_name: environment === 'test' ? proof.worker : 'button-eye-reader-prod',
    worker_name_overridden: false,
    wrangler_environment: environment,
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
            'content-type': 'text/html',
            'permissions-policy': 'camera=(), microphone=(), geolocation=()',
          },
        }),
      ),
    ),
  );
}

describe('deployment API, artifact and promotion orchestration', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    vi.unstubAllEnvs();

    vi.stubEnv('GITHUB_TOKEN', 'test-token');

    vi.stubEnv('GITHUB_REPOSITORY', 'example/reader');

    vi.stubEnv('RELEASE_TAG', 'v0.1.1');

    vi.stubEnv('GITHUB_EVENT_NAME', 'workflow_dispatch');

    vi.stubEnv('GITHUB_REF_TYPE', 'tag');

    vi.stubEnv('GITHUB_REF', 'refs/tags/v0.1.1');

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

  it('requires manual dispatch from the exact selected tag', async () => {
    vi.stubEnv('GITHUB_REF_TYPE', 'branch');

    await expect(validate()).rejects.toThrow('only be dispatched from an existing release tag');

    vi.stubEnv('GITHUB_REF_TYPE', 'tag');

    vi.stubEnv('GITHUB_REF', 'refs/tags/v0.1.2');

    await expect(validate()).rejects.toThrow('does not match');
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

  it('authenticates every TEST marker and asset request while checking bytes and headers', async () => {
    configureSmoke();

    await smoke('test');

    expect(fetch).toHaveBeenCalledTimes(3);

    for (const [url, options] of vi.mocked(fetch).mock.calls) {
      expect(url).toEqual(expect.stringContaining(`${proof.url}/`));

      expect(options).toMatchObject({
        cache: 'no-store',
        headers: {
          'CF-Access-Client-Id': 'test-access-id',
          'CF-Access-Client-Secret': 'test-access-secret',
        },
        redirect: 'manual',
      });
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(marker))),
    );

    await expect(smoke('test')).rejects.toThrow('security headers');

    vi.stubEnv('DEPLOYMENT_URL', 'https://other.example.workers.dev');

    await expect(smoke('test')).rejects.toThrow('does not match');
  });

  it('allows TEST smoke checks without Access credentials when both are unset', async () => {
    configureSmoke();

    vi.stubEnv('CLOUDFLARE_ACCESS_CLIENT_ID', '');

    vi.stubEnv('CLOUDFLARE_ACCESS_CLIENT_SECRET', '');

    await expect(smoke('test')).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledTimes(3);

    for (const [, options] of vi.mocked(fetch).mock.calls) {
      expect(options?.headers).toBeUndefined();
    }
  });

  it.each(['CLOUDFLARE_ACCESS_CLIENT_ID', 'CLOUDFLARE_ACCESS_CLIENT_SECRET'])(
    'rejects a partial TEST Access credential pair when %s is missing',
    async (name) => {
      configureSmoke();

      vi.stubEnv(name, '');

      await expect(smoke('test')).rejects.toThrow(
        'Configure both Cloudflare Access service token secrets or leave both unset.',
      );

      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('never sends Access credentials to PROD even when present in the environment', async () => {
    configureSmoke('production');

    await smoke('production');

    expect(fetch).toHaveBeenCalledTimes(3);

    for (const [, options] of vi.mocked(fetch).mock.calls) {
      expect(options?.headers).toBeUndefined();

      expect(options?.redirect).toBe('manual');
    }

    vi.stubEnv('CLOUDFLARE_ACCESS_CLIENT_ID', '');

    vi.stubEnv('CLOUDFLARE_ACCESS_CLIENT_SECRET', '');

    await expect(smoke('production')).resolves.toBeUndefined();
  });

  it.each([302, 401, 403])(
    'reports Access rejection %s without following redirects or retrying',
    async (status) => {
      for (const successfulRequests of [0, 2]) {
        configureSmoke();

        vi.mocked(fetch).mockImplementationOnce(() =>
          Promise.resolve(
            new Response(successfulRequests === 0 ? '' : marker, {
              headers: { Location: 'https://login.example.com' },
              status: successfulRequests === 0 ? status : 200,
            }),
          ),
        );

        if (successfulRequests > 0) {
          vi.mocked(fetch).mockImplementationOnce(() => Promise.resolve(new Response(marker)));

          vi.mocked(fetch).mockImplementationOnce(() =>
            Promise.resolve(
              new Response('', {
                headers: { Location: 'https://login.example.com' },
                status,
              }),
            ),
          );
        }

        await expect(smoke('test')).rejects.toThrow(
          `Deployment smoke request rejected (test, ${status})`,
        );

        expect(fetch).toHaveBeenCalledTimes(successfulRequests + 1);

        expect(fetch).not.toHaveBeenCalledWith(
          expect.stringContaining('login.example.com'),
          expect.anything(),
        );
      }
    },
  );

  it('reports that PROD must remain public when it redirects to login', async () => {
    configureSmoke('production');

    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 302 }));

    await expect(smoke('production')).rejects.toThrow('PROD must be publicly accessible');

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves Access authentication when retrying a release marker during propagation', async () => {
    configureSmoke();

    vi.mocked(fetch).mockResolvedValueOnce(new Response('previous release'));

    vi.useFakeTimers();

    try {
      const pending = smoke('test');

      await vi.advanceTimersByTimeAsync(5000);

      await pending;

      expect(fetch).toHaveBeenCalledTimes(4);

      for (const [, options] of vi.mocked(fetch).mock.calls) {
        expect(options?.headers).toEqual({
          'CF-Access-Client-Id': 'test-access-id',
          'CF-Access-Client-Secret': 'test-access-secret',
        });
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
