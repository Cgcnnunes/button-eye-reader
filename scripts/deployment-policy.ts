export interface DeploymentProof {
  artifact: number;
  attempt: number;
  branch: string;
  digest: string;
  head: string;
  pr: number;
  run: number;
  sha: string;
  url: string;
  version: string;
  worker: string;
}

export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected deployment metadata object.');
  }

  return value as Record<string, unknown>;
}

export function text(value: unknown): string {
  if (typeof value !== 'string' || !value) {
    throw new Error('Expected nonempty deployment metadata string.');
  }

  return value;
}

export function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error('Expected positive deployment metadata integer.');
  }

  return value;
}

export function releaseTag(value: unknown): string {
  const tag = text(value);

  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag)) {
    throw new Error('Select an existing vX.Y.Z prerelease tag, never a branch or SHA.');
  }

  return tag;
}

export function deploymentUrl(value: unknown): string {
  const url = new URL(text(value));

  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.workers.dev') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('DEPLOYMENT_URL must be the exact HTTPS workers.dev root URL.');
  }

  return url.origin;
}

export function parseProof(body: unknown): DeploymentProof {
  const matches = [...text(body).matchAll(/<!-- tested-deployment (\{[^\n]*\}) -->/g)];

  if (matches.length !== 1) {
    throw new Error('Release must contain exactly one TEST deployment provenance record.');
  }

  const value = object(JSON.parse(matches[0][1]) as unknown);
  const proof = {
    artifact: integer(value.artifact),
    attempt: integer(value.attempt),
    branch: text(value.branch),
    digest: text(value.digest),
    head: text(value.head),
    pr: integer(value.pr),
    run: integer(value.run),
    sha: text(value.sha),
    url: deploymentUrl(value.url),
    version: text(value.version),
    worker: text(value.worker),
  };

  if (
    !/^sha256:[a-f0-9]{64}$/.test(proof.digest) ||
    !/^[a-f0-9]{40}$/.test(proof.sha) ||
    !/^[a-f0-9]{40}$/.test(proof.head) ||
    !/^reader-\d{5}$/.test(proof.branch) ||
    !/^[a-f0-9-]{36}$/.test(proof.version) ||
    proof.worker !== 'button-eye-reader-test'
  ) {
    throw new Error('Invalid TEST artifact digest, commit, Worker or version.');
  }

  return proof;
}

export function assertEvidence(
  tag: string,
  sha: string,
  releaseValue: unknown,
  runValue: unknown,
  artifactValue: unknown,
): DeploymentProof {
  const release = object(releaseValue);
  const proof = parseProof(release.body);
  const run = object(runValue);
  const artifact = object(artifactValue);
  const artifactRun = object(artifact.workflow_run);

  if (
    release.tag_name !== releaseTag(tag) ||
    release.draft !== false ||
    release.prerelease !== true ||
    release.target_commitish !== sha ||
    proof.sha !== sha
  ) {
    throw new Error('Only the original TEST prerelease at the exact tagged commit can deploy.');
  }

  if (
    run.id !== proof.run ||
    run.run_attempt !== proof.attempt ||
    run.path !== '.github/workflows/deploy-to-test.yml' ||
    run.event !== 'push' ||
    run.head_branch !== 'main' ||
    run.head_sha !== proof.sha ||
    run.status !== 'completed' ||
    run.conclusion !== 'success'
  ) {
    throw new Error(
      'The exact TEST push-to-main workflow attempt must have completed successfully.',
    );
  }

  if (
    artifact.id !== proof.artifact ||
    artifact.name !== `tested-site-${proof.run}-${proof.attempt}` ||
    artifact.expired !== false ||
    artifact.digest !== proof.digest ||
    artifactRun.id !== proof.run ||
    artifactRun.head_sha !== proof.sha
  ) {
    throw new Error(
      'TEST artifact is expired, replaced or does not match the successful workflow.',
    );
  }

  return proof;
}

export function assertMergedPullRequest(value: unknown, proof: DeploymentProof): void {
  const pr = object(value);
  const base = object(pr.base);
  const head = object(pr.head);
  const baseRepository = object(base.repo);
  const headRepository = object(head.repo);

  if (
    pr.number !== proof.pr ||
    pr.merged !== true ||
    pr.merge_commit_sha !== proof.sha ||
    base.ref !== 'main' ||
    head.ref !== proof.branch ||
    head.sha !== proof.head ||
    baseRepository.full_name !== headRepository.full_name
  ) {
    throw new Error('TEST provenance does not match the merged same-repository PR and squash SHA.');
  }
}

export function deploymentRecord(
  value: string,
  environment: string,
): {
  url: string;
  version: string;
  worker: string;
} {
  if (environment !== 'test' && environment !== 'production') {
    throw new Error('Unknown deployment environment.');
  }

  const records = value
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => object(JSON.parse(line) as unknown))
    .filter((entry) => entry.type === 'deploy');

  if (records.length !== 1) {
    throw new Error('Expected exactly one successful Wrangler deploy record.');
  }

  const record = records[0];
  const worker = environment === 'test' ? 'button-eye-reader-test' : 'button-eye-reader';
  const version = text(record.version_id);

  if (
    record.worker_name !== worker ||
    record.wrangler_environment !== environment ||
    record.worker_name_overridden !== false ||
    !/^[a-f0-9-]{36}$/.test(version) ||
    !Array.isArray(record.targets)
  ) {
    throw new Error('Wrangler deployed an unexpected Worker, environment or version.');
  }

  const urls = record.targets.filter(
    (target): target is string => typeof target === 'string' && target.includes('.workers.dev'),
  );

  if (urls.length !== 1) {
    throw new Error('Expected exactly one workers.dev deployment URL.');
  }

  return { url: deploymentUrl(urls[0]), version, worker };
}
