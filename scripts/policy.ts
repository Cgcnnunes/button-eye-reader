export type ReleaseKind = 'major' | 'minor' | 'patch';

export interface CommitSubject {
  description: string;
  number: number;
  type: string;
}

export const FIRST_VERSION = '0.1.0';

export function parseSubject(subject: string): CommitSubject {
  const match = /^(feat|chore|refactor|fix|doc)\(reader-(\d{5})\): ([a-z].*)$/.exec(subject);

  if (
    !match ||
    subject.length > 120 ||
    subject.trim() !== subject ||
    subject.includes('\n') ||
    Number(match[2]) === 0
  ) {
    throw new Error(
      'Use type(reader-00001): lower-case description, at most 120 characters. Types: feat, chore, refactor, fix, doc.',
    );
  }

  return { description: match[3], number: Number(match[2]), type: match[1] };
}

export function readerId(number: number): string {
  if (!Number.isSafeInteger(number) || number < 1 || number > 99999) {
    throw new Error('Reader IDs must be between 00001 and 99999.');
  }

  return `reader-${String(number).padStart(5, '0')}`;
}

export function nextCommitNumber(subjects: string[]): number {
  let highest = 0;

  for (const subject of subjects) {
    const match = /^(?:feat|chore|refactor|fix|doc)\(reader-(\d{5})\): /.exec(subject);

    if (match) {
      highest = Math.max(highest, Number(match[1]));
    }
  }

  readerId(highest + 1);

  return highest + 1;
}

export function isDocumentation(path: string): boolean {
  return (
    path === 'README.md' ||
    path === 'CHANGELOG.md' ||
    path === '.github/copilot-instructions.md' ||
    /^docs\/.+\.md$/.test(path)
  );
}

export function assertDocumentation(paths: string[]): void {
  if (!paths.some(isDocumentation)) {
    throw new Error(
      'Every commit must update README.md, CHANGELOG.md, docs/*.md or .github/copilot-instructions.md. Update meaningful documentation, not just a checkbox.',
    );
  }
}

export function branchNumber(branch: string): number {
  const match = /^reader-(\d{5})$/.exec(branch);

  if (!match || Number(match[1]) === 0) {
    throw new Error('Work on an incrementing reader-00001 feature branch, never main.');
  }

  return Number(match[1]);
}

export function releaseKind(body: string): ReleaseKind {
  const text = body.replace(/<!--[\s\S]*?-->/g, '').replace(/```[\s\S]*?```/g, '');
  const choices = [...text.matchAll(/^\s*-\s+\[([ xX])\]\s+(major|minor|patch)\s*$/gm)];

  if (choices.length !== 3 || new Set(choices.map((choice) => choice[2])).size !== 3) {
    throw new Error(
      'The PR must contain the three standard major/minor/patch checkboxes exactly once.',
    );
  }

  const checked = choices.filter((choice) => choice[1].toLowerCase() === 'x');

  if (checked.length !== 1) {
    throw new Error('Select exactly one PR release checkbox: major, minor or patch.');
  }

  const kind = checked[0][2];

  if (kind !== 'major' && kind !== 'minor' && kind !== 'patch') {
    throw new Error('Unknown release kind.');
  }

  return kind;
}

function versionParts(version: string): [number, number, number] {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Invalid semantic version: ${version}`);
  }

  const parts = version.split('.').map(Number);

  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new Error('Version component is too large.');
  }

  return [parts[0], parts[1], parts[2]];
}

export function latestVersion(tags: string[]): string | null {
  const versions = tags
    .filter((tag) => /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag))
    .map((tag) => tag.slice(1));

  versions.sort((a, b) => {
    const left = versionParts(a);
    const right = versionParts(b);

    return right[0] - left[0] || right[1] - left[1] || right[2] - left[2];
  });

  return versions[0] ?? null;
}

export function nextVersion(previous: string | null, kind: ReleaseKind): string {
  if (!previous) {
    return FIRST_VERSION;
  }

  const [major, minor, patch] = versionParts(previous);

  return kind === 'major'
    ? `${major + 1}.0.0`
    : kind === 'minor'
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;
}

export function assertVersion(version: string, previous: string | null, kind: ReleaseKind): void {
  const expected = nextVersion(previous, kind);

  if (version !== expected) {
    throw new Error(
      `PR selects ${kind}; package.json must be ${expected}, not ${version}. Run npm run release:prepare -- ${kind}.`,
    );
  }
}

export function assertLockVersion(version: string, lock: unknown): void {
  if (
    typeof lock !== 'object' ||
    lock === null ||
    !('version' in lock) ||
    lock.version !== version ||
    !('packages' in lock) ||
    typeof lock.packages !== 'object' ||
    lock.packages === null ||
    !('' in lock.packages) ||
    typeof lock.packages[''] !== 'object' ||
    lock.packages[''] === null ||
    !('version' in lock.packages['']) ||
    lock.packages[''].version !== version
  ) {
    throw new Error('package-lock.json root and package entry must match package.json version.');
  }
}
