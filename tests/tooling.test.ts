import { ESLint } from 'eslint';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));

describe('mandatory lint and hook configuration', () => {
  it('enforces types, sorting, quote style and statement spacing', async () => {
    const eslint = new ESLint({ cwd: root });
    const results = await eslint.lintText(
      `import { replaceSlot, defaultBoard } from './store';
interface Probe { z: string; a: string }
const object = { z: 1, a: 2 };
export function probe(value: any) {
  console.log("wrong quotes");
  console.log(value);
  return { object, defaultBoard, replaceSlot };
}`,
      { filePath: fileURLToPath(new URL('../src/store.ts', import.meta.url)) },
    );
    const ids = results.flatMap((result) => result.messages.map((message) => message.ruleId));

    for (const required of [
      '@typescript-eslint/no-explicit-any',
      '@typescript-eslint/explicit-function-return-type',
      '@stylistic/quotes',
      '@stylistic/padding-line-between-statements',
      'perfectionist/sort-named-imports',
      'perfectionist/sort-interfaces',
      'perfectionist/sort-objects',
    ]) {
      expect(ids, required).toContain(required);
    }
  }, 20000);

  it('keeps commit message and ordered pre-commit gates installed', () => {
    const precommit = readFileSync(new URL('../.husky/pre-commit', import.meta.url), 'utf8');
    const commitmsg = readFileSync(new URL('../.husky/commit-msg', import.meta.url), 'utf8');
    const manifest: unknown = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );

    expect(precommit.trim()).toBe('npm run precommit');

    expect(commitmsg.trim()).toBe('npx --no -- commitlint --edit "$1"');

    expect(manifest).toMatchObject({
      'lint-staged': {
        '*.{js,mjs,ts}': ['eslint --fix --max-warnings 0', 'prettier --write'],
      },
      scripts: {
        precommit: 'npm run docs:check && lint-staged && npm run check && npm test',
      },
    });
  });
});
