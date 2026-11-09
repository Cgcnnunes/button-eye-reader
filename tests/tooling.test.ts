import { ESLint } from 'eslint';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));

describe('mandatory lint and hook configuration', () => {
  it('persists custom logs without invocation logs, query strings or traces in both environments', () => {
    const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    const observability = config.split('"observability": {')[1]?.split('"env": {')[0];

    expect(observability).toContain('"enabled": true');

    expect(observability).toContain('"redact_query_string": true');

    expect(observability).toContain('"head_sampling_rate": 1');

    expect(observability).toContain('"invocation_logs": false');

    expect(observability).toContain('"persist": true');

    expect(observability).toMatch(/"traces":\s*\{\s*"enabled": false/);

    expect(config.match(/"observability":/g)).toHaveLength(1);
  });

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

    expect(manifest).not.toMatch(/mediapipe|prepare-assets|postinstall/);

    expect(manifest).toContain('"jose"');

    expect(headers).toContain('camera=()');

    expect(headers).not.toMatch(/wasm-unsafe-eval|blob:|unsafe-inline/);
  });

  it('binds distinct provisioned remote databases while keeping local development isolated', () => {
    const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    const ids = [...config.matchAll(/"database_id":\s*"([^"]+)"/g)].map((match) => match[1]);

    expect(ids).toHaveLength(3);

    expect(ids[0]).toBe('00000000-0000-0000-0000-000000000000');

    expect(new Set(ids).size).toBe(3);

    for (const id of ids.slice(1)) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }

    expect(ids.join(' ')).not.toContain('REPLACE_WITH_');
  });

  it('requires Access at both origins without restoring custom password tooling', () => {
    const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

    for (const environment of ['production', 'test']) {
      const section = config.split(`"${environment}": {`)[1];

      expect(section).toContain('"ACCESS_TEAM_DOMAIN"');

      expect(section).toContain('"ACCESS_AUD"');
    }

    expect(config.match(/"run_worker_first": true/g)).toHaveLength(3);

    expect(readdirSync(new URL('../scripts/', import.meta.url))).not.toContain('accounts.ts');

    expect(readdirSync(new URL('../src/', import.meta.url))).not.toContain('accounts.ts');
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

  it('applies isolated database migrations before each deployment', () => {
    for (const [file, environment, label] of [
      ['deploy-to-test.yml', 'test', 'TEST'],
      ['deploy-to-prod.yml', 'production', 'PROD'],
    ]) {
      const workflow = readFileSync(
        new URL(`../.github/workflows/${file}`, import.meta.url),
        'utf8',
      );
      const command = `npx wrangler d1 migrations apply DB --remote --env ${environment}`;

      expect(workflow).toContain(command);

      expect(workflow.indexOf(`node scripts/deployment.ts access ${environment}`)).toBeLessThan(
        workflow.indexOf(command),
      );

      expect(workflow.indexOf(command)).toBeLessThan(
        workflow.indexOf(`- name: Deploy to ${label}`),
      );
    }
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

  it('exposes separate environment Access credentials only to smoke checks, never builds', () => {
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

    for (const name of ['CLOUDFLARE_ACCESS_CLIENT_ID', 'CLOUDFLARE_ACCESS_CLIENT_SECRET']) {
      for (const workflow of [test, production]) {
        const smoke = workflow
          .split('- name: Smoke test deployment')[1]
          ?.split('\n      - name:')[0];

        expect(smoke).toContain(`${name}: \${{ secrets.${name} }}`);

        expect(workflow.split('- name: Smoke test deployment')[0]).not.toContain(name);

        expect(
          workflow
            .split('- name: Smoke test deployment')[1]
            ?.split('\n      - name:')
            .slice(1)
            .join('\n'),
        ).not.toContain(name);
      }

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
