import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../scripts/repository.ts', import.meta.url));
let directory = '';
let base = '';

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, HUSKY: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function write(name: string, content: string): void {
  writeFileSync(join(directory, name), content);
}

function commit(subject = 'feat(reader-00001): add board', documentation = true): void {
  if (documentation) {
    write('README.md', `${readFileSync(join(directory, 'README.md'), 'utf8')}\nUpdate.\n`);
  }

  git('add', '.');

  git('commit', '-m', subject);
}

function check(command: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [script, command], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_EVENT_PATH: join(directory, 'event.json') },
  });
}

function event(
  body = '- [ ] major\n- [x] minor\n- [ ] patch',
  title = 'feat(reader-00001): add board',
): void {
  write(
    'event.json',
    JSON.stringify({
      pull_request: {
        base: { ref: 'main', sha: base },
        body,
        head: { ref: 'reader-00001', sha: git('rev-parse', 'HEAD') },
        title,
      },
    }),
  );
}

describe('repository CLI integration with isolated Git histories', () => {
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'reader-policy-'));

    git('init', '-b', 'main');

    git('config', 'user.name', 'Test');

    git('config', 'user.email', 'test@example.invalid');

    write('README.md', '# Fixture\n');

    write('package.json', JSON.stringify({ version: '0.1.0' }));

    write(
      'package-lock.json',
      JSON.stringify({
        packages: { '': { version: '0.1.0' } },
        version: '0.1.0',
      }),
    );

    git('add', '.');

    git('commit', '-m', 'Initial commit');

    base = git('rev-parse', 'HEAD');

    git('switch', '-c', 'reader-00001');

    write('.reader-sequence.json', JSON.stringify({ lastBranch: 1 }));
  });

  afterEach(() => {
    rmSync(directory, { force: true, recursive: true });
  });

  it('accepts the initial feature PR without a legacy sequence file', () => {
    commit();

    event();

    const result = check('pr');

    expect(result.status, String(result.stderr)).toBe(0);

    expect(String(result.stdout)).toContain('PR policy passed');
  });

  it('rejects every commit that lacks a documentation change', () => {
    commit();

    write('code.ts', 'export const example = 1;\n');

    commit('fix(reader-00002): fix board', false);

    event();

    const result = check('pr');

    expect(result.status).not.toBe(0);

    expect(String(result.stderr)).toContain('Every commit must update');
  });

  it('checks sequence and squash title relative to main, not feature HEAD', () => {
    commit();

    commit('fix(reader-00003): fix board');

    event();

    expect(String(check('pr').stderr)).toContain('must use reader-00002');

    event(undefined, 'feat(reader-00003): add board');

    expect(String(check('pr').stderr)).toContain('PR title must use reader-00001');
  });

  it('rejects an incorrect bump and more than one release choice', () => {
    commit();

    event('- [x] major\n- [x] minor\n- [ ] patch');

    expect(String(check('pr').stderr)).toContain('Select exactly one');

    write('package.json', JSON.stringify({ version: '0.2.0' }));

    commit('chore(reader-00002): update version');

    event();

    expect(String(check('pr').stderr)).toContain('must be 0.1.0');
  });

  it('checks staged documentation and blocks main', () => {
    git('add', '.reader-sequence.json');

    expect(String(check('staged').stderr)).toContain('Every commit must update');

    write('README.md', '# Updated fixture\n');

    git('add', 'README.md');

    expect(check('staged').status).toBe(0);

    git('switch', 'main');

    expect(String(check('staged').stderr)).toContain('never main');
  });

  it('prints the next commit ID', () => {
    expect(String(check('next').stdout).trim()).toBe('reader-00001');

    commit();

    expect(String(check('next').stdout).trim()).toBe('reader-00002');
  });
});
