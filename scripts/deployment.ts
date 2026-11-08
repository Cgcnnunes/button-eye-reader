import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DeploymentProof } from './deployment-policy.ts';
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
} from './deployment-policy.ts';
import { git } from './git.ts';
import { assertLockVersion, latestVersion } from './policy.ts';

export function required(name: string): string {
  if (!process.env[name]) {
    throw new Error(
      `Missing required environment setting: ${name}. Configure the GitHub environment.`,
    );
  }

  return text(process.env[name]);
}

function repositoryUrl(): string {
  const repository = required('GITHUB_REPOSITORY');

  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9_.-]+$/.test(repository)) {
    throw new Error('Invalid GitHub repository.');
  }

  return `https://api.github.com/repos/${repository}`;
}

export async function api(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const result = await fetch(`${repositoryUrl()}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${required('GITHUB_TOKEN')}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    method,
    signal: AbortSignal.timeout(30000),
  });

  if (result.status === 404 && method === 'GET') {
    return null;
  }

  if (!result.ok) {
    throw new Error(`GitHub ${method} ${path} failed (${result.status}): ${await result.text()}`);
  }

  return (await result.json()) as unknown;
}

export async function previousStable(): Promise<string | undefined> {
  const latest = await api('/releases/latest');

  if (latest === null) {
    return undefined;
  }

  const release = object(latest);

  if (release.draft !== false || release.prerelease !== false) {
    throw new Error('Previous production release must be stable and public.');
  }

  return releaseTag(release.tag_name);
}

export async function validate(): Promise<{
  proof: DeploymentProof;
  release: Record<string, unknown>;
  tag: string;
}> {
  if (
    process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    process.env.GITHUB_REF_TYPE !== 'tag'
  ) {
    throw new Error('PROD can only be dispatched from an existing release tag.');
  }

  const tag = releaseTag(required('RELEASE_TAG'));

  if (process.env.GITHUB_REF !== `refs/tags/${tag}`) {
    throw new Error('Selected workflow tag does not match the release tag being deployed.');
  }

  git('fetch', 'origin', 'main', '--tags');

  if (git('cat-file', '-t', `refs/tags/${tag}`) !== 'tag') {
    throw new Error('Only annotated release tags can deploy.');
  }

  const sha = git('rev-parse', `${tag}^{commit}`);

  git('merge-base', '--is-ancestor', sha, 'origin/main');

  const release = object(await api(`/releases/tags/${tag}`));
  const proof = parseProof(release.body);
  const run = await api(`/actions/runs/${proof.run}`);
  const artifact = await api(`/actions/artifacts/${proof.artifact}`);

  assertEvidence(tag, sha, release, run, artifact);

  assertMergedPullRequest(await api(`/pulls/${proof.pr}`), proof);

  const pkg = object(JSON.parse(git('show', `${sha}:package.json`)) as unknown);

  if (`v${text(pkg.version)}` !== tag) {
    throw new Error('Tag does not match the tested package version.');
  }

  assertLockVersion(
    text(pkg.version),
    JSON.parse(git('show', `${sha}:package-lock.json`)) as unknown,
  );

  const previous = await previousStable();

  if (previous && (previous === tag || latestVersion([previous, tag]) !== tag.slice(1))) {
    throw new Error(
      'Production promotion must move forward, never redeploy or downgrade a release.',
    );
  }

  return { proof, release, tag };
}

export async function download(): Promise<void> {
  const { proof } = await validate();

  if (
    proof.sha !== required('EXPECTED_SHA') ||
    String(proof.artifact) !== required('EXPECTED_ARTIFACT') ||
    proof.digest !== required('EXPECTED_DIGEST') ||
    git('rev-parse', 'HEAD') !== proof.sha
  ) {
    throw new Error('Release changed during approval; select and validate it again.');
  }

  if (existsSync('dist')) {
    throw new Error('Production must start without dist and use only the tested artifact.');
  }

  const response = await fetch(`${repositoryUrl()}/actions/artifacts/${proof.artifact}/zip`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${required('GITHUB_TOKEN')}`,
    },
    signal: AbortSignal.timeout(120000),
  });

  if (!response.ok) {
    throw new Error(`TEST artifact download failed (${response.status}).`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

  if (digest !== proof.digest) {
    throw new Error('Downloaded TEST artifact checksum does not match release provenance.');
  }

  const archive = join(required('RUNNER_TEMP'), 'tested-site.zip');

  writeFileSync(archive, bytes);

  execFileSync('unzip', ['-q', archive, '-d', 'dist'], { stdio: 'inherit' });

  const marker = object(JSON.parse(readFileSync('dist/release.json', 'utf8')) as unknown);

  if (marker.sha !== proof.sha || marker.tag !== required('RELEASE_TAG')) {
    throw new Error('Downloaded site does not identify the tested commit and tag.');
  }
}

export async function smoke(environment: string): Promise<void> {
  const record = deploymentRecord(readFileSync(required('DEPLOYMENT_OUTPUT'), 'utf8'), environment);
  const url = deploymentUrl(required('DEPLOYMENT_URL'));

  if (url !== record.url) {
    throw new Error('Configured environment URL does not match the deployed Worker.');
  }

  const accessClientId = process.env.CLOUDFLARE_ACCESS_CLIENT_ID;
  const accessClientSecret = process.env.CLOUDFLARE_ACCESS_CLIENT_SECRET;
  let headers: Record<string, string> | undefined;

  if (environment === 'test' && (accessClientId || accessClientSecret)) {
    if (!accessClientId || !accessClientSecret) {
      throw new Error(
        'Configure both Cloudflare Access service token secrets or leave both unset.',
      );
    }

    headers = {
      'CF-Access-Client-Id': accessClientId,
      'CF-Access-Client-Secret': accessClientSecret,
    };
  }

  async function request(path: string, timeout: number, anonymousApi = false): Promise<Response> {
    const response = await fetch(`${url}${path}`, {
      cache: 'no-store',
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout),
    });

    if (
      (response.status >= 300 && response.status < 400) ||
      (response.status === 401 && !anonymousApi) ||
      response.status === 403
    ) {
      throw new Error(
        `Deployment smoke request rejected (${environment}, ${response.status}). ${
          environment === 'test'
            ? headers
              ? 'Check Cloudflare Access service token secrets and the Service Auth policy.'
              : 'Check the TEST URL and any unexpected Cloudflare Access policy.'
            : 'PROD must be publicly accessible without Cloudflare Access or redirects.'
        }`,
      );
    }

    return response;
  }

  const marker = readFileSync('dist/release.json', 'utf8');
  const paths = ['/release.json', '/'];

  // A new deployment can take a short time to reach the workers.dev endpoint.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await request('/release.json', 15000);

    if (response.ok && (await response.text()) === marker) {
      break;
    }

    if (attempt === 11) {
      throw new Error('Worker did not serve the tested release marker within one minute.');
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  for (const path of paths) {
    const response = await request(path, 30000);
    const type = response.headers.get('content-type') ?? '';
    const bytes = Buffer.from(await response.arrayBuffer());

    if (!response.ok || !bytes.equals(readFileSync(`dist${path === '/' ? '/index.html' : path}`))) {
      throw new Error(`Deployment asset mismatch: ${path} (${response.status}, ${type}).`);
    }

    if (
      path === '/' &&
      (!response.headers.get('content-security-policy')?.includes("frame-ancestors 'none'") ||
        response.headers.get('permissions-policy') !== 'camera=(), microphone=(), geolocation=()')
    ) {
      throw new Error('Deployment security headers are missing or incorrect.');
    }
  }

  const session = await request('/api/session', 30000, true);

  if (
    session.status !== 401 ||
    !session.headers.get('content-type')?.includes('application/json') ||
    !session.headers.get('cache-control')?.includes('no-store')
  ) {
    throw new Error('Deployment account API must reject anonymous sessions with uncached JSON.');
  }

  const anonymous = object(await session.json());

  if (
    typeof anonymous.error !== 'string' ||
    Object.keys(anonymous).some((key) => key !== 'error')
  ) {
    throw new Error('Deployment account API disclosed unexpected anonymous session data.');
  }

  const summary = process.env.GITHUB_STEP_SUMMARY;

  if (summary) {
    appendFileSync(summary, `\nVerified ${environment}: ${url}\n`);
  }
}

export async function promote(): Promise<void> {
  const { proof, release, tag } = await validate();

  if (git('rev-parse', 'HEAD') !== proof.sha) {
    throw new Error('Production checkout differs from the tested tag.');
  }

  await api(`/releases/${integer(release.id)}`, 'PATCH', {
    make_latest: 'true',
    prerelease: false,
  });

  console.log(`Promoted ${tag} to a stable GitHub release; the annotated tag is unchanged.`);
}

async function run(): Promise<void> {
  const command = process.argv[2];

  if (command === 'validate') {
    const { proof } = await validate();

    appendFileSync(
      required('GITHUB_OUTPUT'),
      `artifact=${proof.artifact}\ndigest=${proof.digest}\nsha=${proof.sha}\n`,
    );
  } else if (command === 'download') {
    await download();
  } else if (command === 'smoke') {
    await smoke(text(process.argv[3]));
  } else if (command === 'promote') {
    await promote();
  } else {
    throw new Error('Unknown deployment command.');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await run();
}
