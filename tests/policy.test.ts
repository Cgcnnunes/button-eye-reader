import { describe, expect, it } from 'vitest';
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
} from '../scripts/policy.ts';

const choices = '- [ ] major\n- [x] minor\n- [ ] patch';

describe('repository policies', () => {
  it('accepts only the exact commit shape and allowed types', () => {
    expect(parseSubject('feat(reader-00001): add phrase board')).toEqual({
      description: 'add phrase board',
      number: 1,
      type: 'feat',
    });
  });

  it('rejects lockfile drift and accepts synchronized root versions', () => {
    const lock = { packages: { '': { version: '0.1.0' } }, version: '0.1.0' };

    assertLockVersion('0.1.0', lock);

    expect(() => {
      assertLockVersion('0.2.0', lock);
    }).toThrow();

    expect(() => {
      assertLockVersion('0.1.0', { ...lock, packages: {} });
    }).toThrow();

    expect(() => {
      assertLockVersion('0.1.0', null);
    }).toThrow();

    expect(() => {
      assertLockVersion('0.1.0', { ...lock, packages: { '': { version: '0.0.1' } } });
    }).toThrow();
  });

  it.each([
    'docs(reader-00001): update docs',
    'feat(reader-0001): add board',
    'feat(reader-00000): add board',
    'feat(reader-00001): Add board',
    'fix(reader-00001): ',
    'fix(reader-00001): add board ',
    'fix(reader-00001): add\nboard',
    `fix(reader-00001): ${'a'.repeat(103)}`,
    'Merge pull request #1',
    'Revert "a change"',
  ])('rejects malformed subject %s', (subject) => {
    expect(() => parseSubject(subject)).toThrow();
  });

  it('checks the complete 120-character subject boundary', () => {
    const prefix = 'fix(reader-00001): ';

    expect(parseSubject(prefix + 'a'.repeat(120 - prefix.length)).number).toBe(1);

    expect(() => parseSubject(prefix + 'a'.repeat(121 - prefix.length))).toThrow();
  });

  it('increments commits without counting legacy initial messages', () => {
    expect(nextCommitNumber(['Initial commit'])).toBe(1);

    expect(
      nextCommitNumber(['fix(reader-00009): fix audio', 'feat(reader-00002): add board']),
    ).toBe(10);

    expect(readerId(10)).toBe('reader-00010');

    expect(() => nextCommitNumber(['chore(reader-99999): finish'])).toThrow();
  });

  it.each([0, -1, 100000, 1.5, NaN])('rejects invalid sequence %s', (number) => {
    expect(() => readerId(number)).toThrow();
  });

  it('requires real documentation paths, not PR checkboxes', () => {
    assertDocumentation(['src/main.ts', 'docs/ARCHITECTURE.md']);

    assertDocumentation(['README.md']);

    assertDocumentation(['CHANGELOG.md']);

    assertDocumentation(['.github/copilot-instructions.md']);

    expect(() => {
      assertDocumentation(['src/main.ts', '.github/pull_request_template.md']);
    }).toThrow();

    expect(() => {
      assertDocumentation(['docs/not-documentation.ts']);
    }).toThrow();

    expect(() => {
      assertDocumentation([]);
    }).toThrow();
  });

  it('requires an exact five-digit feature branch name', () => {
    expect(branchNumber('reader-00001')).toBe(1);

    for (const name of ['main', 'master', 'reader-0001', 'reade-00001', 'reader-00000']) {
      expect(() => branchNumber(name)).toThrow();
    }
  });

  it('requires exactly one standard release checkbox', () => {
    expect(releaseKind(choices)).toBe('minor');

    expect(releaseKind(choices.replace('[x] minor', '[X] minor'))).toBe('minor');

    expect(
      releaseKind(choices.replace('[x] minor', '[ ] minor').replace('[ ] patch', '[x] patch')),
    ).toBe('patch');

    expect(
      releaseKind(choices.replace('[x] minor', '[ ] minor').replace('[ ] major', '[x] major')),
    ).toBe('major');

    expect(() => releaseKind(choices.replace('[x]', '[ ]'))).toThrow();

    expect(() => releaseKind(choices.replace('[ ] patch', '[x] patch'))).toThrow();

    expect(() => releaseKind(`${choices}\n- [x] minor`)).toThrow();

    expect(() => releaseKind('')).toThrow();
  });

  it('does not count examples hidden in comments or code blocks', () => {
    expect(releaseKind(`${choices}\n<!-- - [x] patch -->\n\`\`\`\n- [x] patch\n\`\`\``)).toBe(
      'minor',
    );

    expect(() => releaseKind(`<!-- ${choices} -->`)).toThrow();
  });

  it('sorts semantic versions numerically and ignores unrelated tags', () => {
    expect(
      latestVersion(['v0.9.0', 'v0.10.0', 'reader-v1.0.0', 'v01.0.0', 'v2.0.0', 'v1.99.99']),
    ).toBe('2.0.0');

    expect(latestVersion(['v1.2.3', 'v1.2.12'])).toBe('1.2.12');

    expect(latestVersion([])).toBeNull();

    expect(() => latestVersion(['v999999999999999999.0.0', 'v0.1.0'])).toThrow();
  });

  it('creates v0.1.0 once then resets lower components on major/minor', () => {
    expect(nextVersion(null, 'minor')).toBe('0.1.0');

    expect(nextVersion('1.2.3', 'major')).toBe('2.0.0');

    expect(nextVersion('1.2.3', 'minor')).toBe('1.3.0');

    expect(nextVersion('1.2.3', 'patch')).toBe('1.2.4');

    expect(() => nextVersion('01.2.3', 'patch')).toThrow();

    expect(() => nextVersion('999999999999999999.0.0', 'patch')).toThrow();

    assertVersion('0.1.0', null, 'minor');

    expect(() => {
      assertVersion('1.2.4', '1.2.3', 'minor');
    }).toThrow();
  });
});
