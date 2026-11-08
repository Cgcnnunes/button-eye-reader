import { ESLint } from 'eslint';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));

describe('mandatory lint and hook configuration', () => {
  it('uses height-adaptive tablet layouts without hiding clipped content', () => {
    const styles = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    const tablet = styles
      .split('@media (min-width: 700px) {')[1]
      ?.split('@media (max-width: 699px)')[0];

    expect(tablet).toContain('height: 100dvh');

    expect(tablet).toContain('grid-template-rows: auto minmax(0, 1fr) auto auto');

    expect(tablet).toContain('container-type: size');

    expect(tablet).toContain('8cqh');

    expect(tablet).toContain('resize: none');

    expect(styles).not.toMatch(/overflow(?:-x|-y)?:\s*(?:hidden|clip)/);

    expect(tablet).not.toContain('min-height: 380px');
  });

  it('keeps static TEST and PROD free of custom tracking and report infrastructure', () => {
    const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    const production = config.split('"production": {')[1].split('"test": {')[0];
    const test = config.split('"test": {')[1];

    expect(production).toContain('"name": "button-eye-reader-prod"');

    expect(test).toContain('"name": "button-eye-reader-test"');

    expect(config).not.toMatch(/r2_buckets|crons|diagnostics|DEPLOYMENT_ENVIRONMENT/);

    const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');

    expect(manifest).not.toMatch(/mediapipe|jose|prepare-assets|postinstall/);

    expect(headers).toContain('camera=()');

    expect(headers).not.toMatch(/wasm-unsafe-eval|blob:|unsafe-inline/);
  });

  it('cancels superseded PR validation while queueing deployments independently', () => {
    const validation = readFileSync(
      new URL('../.github/workflows/execute-pr-validation.yml', import.meta.url),
      'utf8',
    );

    expect(validation).toContain('group: pr-validation-${{ github.event.pull_request.number }}');

    expect(validation).toContain('cancel-in-progress: true');

    for (const [file, group] of [
      ['deploy-to-test.yml', 'deploy-test'],
      ['deploy-to-prod.yml', 'deploy-production'],
    ]) {
      const workflow = readFileSync(
        new URL(`../.github/workflows/${file}`, import.meta.url),
        'utf8',
      );

      expect(workflow).toContain(`group: ${group}`);

      expect(workflow).toContain('cancel-in-progress: false');

      expect(workflow).toContain('queue: max');
    }
  });

  it('keeps exactly three workflows and validates code independently in PR and TEST', () => {
    expect(readdirSync(new URL('../.github/workflows/', import.meta.url)).sort()).toEqual([
      'deploy-to-prod.yml',
      'deploy-to-test.yml',
      'execute-pr-validation.yml',
    ]);

    const validation = readFileSync(
      new URL('../.github/workflows/execute-pr-validation.yml', import.meta.url),
      'utf8',
    );
    const test = readFileSync(
      new URL('../.github/workflows/deploy-to-test.yml', import.meta.url),
      'utf8',
    );

    expect(validation).not.toMatch(/^\s+push:/m);

    expect(validation).toContain('run: npm run repo:check');

    for (const workflow of [validation, test]) {
      expect(workflow).toContain('runs-on: ubuntu-24.04');

      expect(workflow).toContain('actions/checkout@v5');

      expect(workflow).toContain('actions/setup-node@v5');

      expect(workflow).toContain('run: npm ci');

      expect(workflow).toContain('run: npm run verify');

      expect(workflow.indexOf('run: npm ci')).toBeLessThan(workflow.indexOf('run: npm run verify'));
    }

    expect(test).not.toContain('npm run repo:check');

    expect(test).not.toContain('workflow_run:');

    expect(test).not.toContain('needs:');
  });

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

  it('exposes Access credentials only to TEST smoke checks, never builds or PROD', () => {
    const test = readFileSync(
      new URL('../.github/workflows/deploy-to-test.yml', import.meta.url),
      'utf8',
    );
    const production = readFileSync(
      new URL('../.github/workflows/deploy-to-prod.yml', import.meta.url),
      'utf8',
    );
    const validation = readFileSync(
      new URL('../.github/workflows/execute-pr-validation.yml', import.meta.url),
      'utf8',
    );
    const smokeStep = test
      .split('- name: Smoke test deployment')[1]
      ?.split('- name: Upload artifact')[0];

    for (const name of ['CLOUDFLARE_ACCESS_CLIENT_ID', 'CLOUDFLARE_ACCESS_CLIENT_SECRET']) {
      expect(smokeStep).toContain(`${name}: \${{ secrets.${name} }}`);

      expect(test.split('- name: Smoke test deployment')[0]).not.toContain(name);

      expect(test.split('- name: Upload artifact')[1]).not.toContain(name);

      expect(production).not.toContain(name);

      expect(validation).not.toContain(name);
    }
  });

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

  it('deploys TEST on main pushes and restricts manual PROD promotion to tested tags', () => {
    const test = readFileSync(
      new URL('../.github/workflows/deploy-to-test.yml', import.meta.url),
      'utf8',
    );
    const production = readFileSync(
      new URL('../.github/workflows/deploy-to-prod.yml', import.meta.url),
      'utf8',
    );

    expect(test).toMatch(/^\s+push:\n\s+branches: \[main\]/m);

    expect(test).toContain('ref: ${{ github.sha }}');

    expect(test).not.toContain('--env production');

    expect(test.indexOf('npm run verify')).toBeLessThan(test.indexOf('--env test'));

    expect(test.indexOf('smoke test')).toBeLessThan(test.indexOf('actions/upload-artifact@v4'));

    expect(test.indexOf('actions/upload-artifact@v4')).toBeLessThan(
      test.indexOf('release.ts publish'),
    );

    expect(production).toContain('workflow_dispatch:');

    expect(production).not.toMatch(/^\s+(push|pull_request):/m);

    expect(production).toContain('RELEASE_TAG: ${{ github.ref_name }}');

    expect(production).toContain('ref: ${{ github.ref }}');

    expect(production).not.toContain('test_approved');

    expect(production).not.toContain('inputs.tag');

    expect(production).toContain('environment: production');

    expect(production).toContain('ref: ${{ needs.validate.outputs.sha }}');

    expect(production).toContain('npm ci --ignore-scripts');

    expect(production).not.toMatch(/npm run (build|verify)|vite build/);

    expect(production.indexOf('deployment.ts download')).toBeLessThan(
      production.indexOf('--env production'),
    );

    expect(production.indexOf('smoke production')).toBeLessThan(
      production.indexOf('deployment.ts promote'),
    );
  });
});
