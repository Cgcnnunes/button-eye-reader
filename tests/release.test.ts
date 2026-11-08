import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  append: vi.fn(),
  git: vi.fn<(...args: string[]) => string>(),
  previousStable: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
}));

vi.mock('node:fs', () => ({
  appendFileSync: mocks.append,
  readFileSync: mocks.read,
  writeFileSync: mocks.write,
}));

vi.mock('../scripts/git.ts', () => ({
  git: mocks.git,
  lines: (value: string): string[] => value.split('\n').filter(Boolean),
}));

vi.mock('../scripts/deployment.ts', () => ({
  api: mocks.api,
  previousStable: mocks.previousStable,
  required: (name: string): string => {
    const value = process.env[name];

    if (!value) {
      throw new Error(`Missing ${name}`);
    }

    return value;
  },
}));

const sha = 'a'.repeat(40);
const originalArguments = [...process.argv];
const pullRequest = {
  base: { ref: 'main', repo: { full_name: 'example/reader' } },
  body: '- [ ] major\n- [x] minor\n- [ ] patch',
  head: {
    ref: 'reader-00002',
    repo: { full_name: 'example/reader' },
    sha: 'c'.repeat(40),
  },
  merge_commit_sha: sha,
  merged: true,
  merged_at: '2026-01-01T00:00:00Z',
  number: 2,
  title: 'feat(reader-00002): gate production deployment',
};
const record = JSON.stringify({
  targets: ['https://button-eye-reader-test.example.workers.dev'],
  type: 'deploy',
  version_id: '12345678-1234-1234-1234-123456789abc',
  worker_name: 'button-eye-reader-test',
  worker_name_overridden: false,
  wrangler_environment: 'test',
});

async function run(command: string): Promise<void> {
  process.argv[2] = command;

  await import('../scripts/release.ts');
}

describe('TEST prerelease creation and retry orchestration', () => {
  beforeEach(() => {
    vi.resetModules();

    vi.resetAllMocks();

    vi.unstubAllEnvs();

    for (const [name, value] of Object.entries({
      ARTIFACT_DIGEST: 'b'.repeat(64),
      ARTIFACT_ID: '12',
      CLOUDFLARE_ACCOUNT_ID: 'account',
      CLOUDFLARE_API_TOKEN: 'test-token',
      DEPLOYMENT_OUTPUT: 'deploy.jsonl',
      DEPLOYMENT_URL: 'https://button-eye-reader-test.example.workers.dev',
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_REPOSITORY: 'example/reader',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_RUN_ID: '34',
      GITHUB_SHA: sha,
      GITHUB_STEP_SUMMARY: 'summary',
      GITHUB_TOKEN: 'test-token',
    })) {
      vi.stubEnv(name, value);
    }

    mocks.read.mockImplementation((path: string) => {
      if (path === 'package.json') {
        return JSON.stringify({ version: '0.2.0' });
      }

      if (path === 'package-lock.json') {
        return JSON.stringify({ packages: { '': { version: '0.2.0' } }, version: '0.2.0' });
      }

      return record;
    });

    mocks.git.mockImplementation((...args: string[]) => {
      if (args[0] === 'rev-parse' || args[0] === 'rev-list') {
        return sha;
      }

      if (args[0] === 'show') {
        return args.includes('--format=%s') ? pullRequest.title : 'c'.repeat(40);
      }

      if (args[0] === 'diff-tree') {
        return 'README.md';
      }

      if (args[0] === 'tag' && args.includes('--list')) {
        return 'v0.1.0';
      }

      if (args[0] === 'cat-file') {
        return 'tag';
      }

      return '';
    });

    mocks.previousStable.mockResolvedValue('v0.1.0');

    mocks.api.mockImplementation((path: string) => {
      if (path === `/commits/${sha}/pulls`) {
        return Promise.resolve([pullRequest]);
      }

      if (path === '/pulls/2') {
        return Promise.resolve(pullRequest);
      }

      return Promise.resolve(
        path === '/releases/generate-notes' ? { body: 'Automatically generated notes' } : null,
      );
    });
  });

  afterEach(() => {
    process.argv = [...originalArguments];
  });

  it('prepares the release marker without creating a tag or prerelease', async () => {
    await run('prepare');

    expect(mocks.write).toHaveBeenCalledWith(
      'dist/release.json',
      `${JSON.stringify({ sha, tag: 'v0.2.0' })}\n`,
    );

    expect(mocks.git.mock.calls.some((args) => args[0] === 'push')).toBe(false);

    expect(mocks.api).toHaveBeenCalledWith(`/commits/${sha}/pulls`);

    expect(mocks.api).toHaveBeenCalledWith('/pulls/2');

    expect(mocks.api).not.toHaveBeenCalledWith(
      '/releases/generate-notes',
      'POST',
      expect.anything(),
    );
  });

  it('associates the main squash push with its PR and creates the TEST prerelease', async () => {
    await run('publish');

    expect(mocks.git).toHaveBeenCalledWith('tag', '-a', 'v0.2.0', sha, '-m', 'Release v0.2.0');

    expect(mocks.git).toHaveBeenCalledWith('push', 'origin', 'refs/tags/v0.2.0');

    expect(mocks.api).toHaveBeenCalledWith('/releases/generate-notes', 'POST', {
      previous_tag_name: 'v0.1.0',
      tag_name: 'v0.2.0',
      target_commitish: sha,
    });

    expect(mocks.api).toHaveBeenCalledWith(
      '/releases',
      'POST',
      expect.objectContaining({ make_latest: 'false', prerelease: true, tag_name: 'v0.2.0' }),
    );

    expect(mocks.append).toHaveBeenCalledWith(
      'summary',
      '\n## TEST prerelease v0.2.0\n\nDeployed to TEST; verify this exact version before PROD: https://button-eye-reader-test.example.workers.dev\n',
    );

    expect(JSON.stringify(mocks.api.mock.calls)).toContain('<!-- tested-deployment');
  });

  it('accepts only the exact GitHub squash PR-number suffix', async () => {
    const original = mocks.git.getMockImplementation();

    if (!original) {
      throw new Error('Missing Git fixture implementation.');
    }

    mocks.git.mockImplementation((...args: string[]) =>
      args[0] === 'show' && args.includes('--format=%s')
        ? `${pullRequest.title} (#2)`
        : original(...args),
    );

    await run('prepare');

    expect(mocks.write).toHaveBeenCalled();
  });

  it('rejects a squash suffix for a different PR', async () => {
    const original = mocks.git.getMockImplementation();

    if (!original) {
      throw new Error('Missing Git fixture implementation.');
    }

    mocks.git.mockImplementation((...args: string[]) =>
      args[0] === 'show' && args.includes('--format=%s')
        ? `${pullRequest.title} (#99)`
        : original(...args),
    );

    await expect(run('prepare')).rejects.toThrow('exact GitHub PR-number');
  });

  it('does not create tags or releases if deployment output is invalid', async () => {
    mocks.read.mockImplementation((path: string) => {
      if (path === 'package.json') {
        return JSON.stringify({ version: '0.2.0' });
      }

      if (path === 'package-lock.json') {
        return JSON.stringify({ packages: { '': { version: '0.2.0' } }, version: '0.2.0' });
      }

      return '';
    });

    await expect(run('publish')).rejects.toThrow('deploy record');

    expect(mocks.git.mock.calls.some((args) => args[0] === 'push')).toBe(false);
  });

  it('rejects pushes outside main', async () => {
    vi.stubEnv('GITHUB_REF', 'refs/heads/feature');

    await expect(run('prepare')).rejects.toThrow('pushes to main');
  });

  it('rejects commits without one associated main PR', async () => {
    mocks.api.mockResolvedValue([]);

    await expect(run('prepare')).rejects.toThrow('exactly one PR targeting main');
  });

  it('rejects a PR association that is not merged into main', async () => {
    mocks.api.mockImplementation((path: string) =>
      Promise.resolve(path === '/pulls/2' ? { ...pullRequest, merged: false } : [pullRequest]),
    );

    await expect(run('prepare')).rejects.toThrow('merged same-repository PR targeting main');
  });

  it('recovers when the immutable tag exists but release creation previously failed', async () => {
    const original = mocks.git.getMockImplementation();

    if (!original) {
      throw new Error('Missing Git fixture implementation.');
    }

    mocks.git.mockImplementation((...args: string[]) =>
      args[0] === 'tag' && args.includes('--list') && !args.includes('--merged')
        ? 'v0.1.0\nv0.2.0'
        : original(...args),
    );

    await run('prepare');

    expect(mocks.write).toHaveBeenCalled();

    expect(mocks.git.mock.calls.some((args) => args[0] === 'push')).toBe(false);
  });
});
