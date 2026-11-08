import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import { isDiagnosticReport, MAX_REPORT_BYTES, REPORT_RETENTION_MS } from './diagnostics';

interface StoredObject {
  customMetadata?: Record<string, string>;
  key: string;
  size: number;
}

interface StoredBody extends StoredObject {
  text(): Promise<string>;
}

interface ReportBucket {
  delete(key: string): Promise<void>;

  get(key: string): Promise<StoredBody | null>;

  list(options: {
    cursor?: string;
    include: string[];
    limit: number;
    prefix: string;
  }): Promise<{ cursor?: string; objects: StoredObject[]; truncated: boolean }>;

  put(
    key: string,
    value: string,
    options: {
      customMetadata: Record<string, string>;
      httpMetadata: { contentType: string };
    },
  ): Promise<unknown>;
}

export interface ReportEnvironment {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DEPLOYMENT_ENVIRONMENT?: string;
  REPORT_ACCESS_AUD?: string;
  REPORT_ACCESS_TEAM?: string;
  REPORTS?: ReportBucket;
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function response(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
    },
    status,
  });
}

function expires(object: StoredObject): number {
  return Number(object.customMetadata?.expires);
}

async function authorize(
  request: Request,
  environment: ReportEnvironment,
): Promise<Response | null> {
  const team = environment.REPORT_ACCESS_TEAM;
  const audience = environment.REPORT_ACCESS_AUD;

  if (
    !team ||
    !/^[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/.test(team) ||
    !audience ||
    !environment.REPORTS ||
    !['test', 'production'].includes(environment.DEPLOYMENT_ENVIRONMENT ?? '')
  ) {
    return response(503, { error: 'Private report storage and Access are not configured.' });
  }

  const token = request.headers.get('Cf-Access-Jwt-Assertion');

  if (!token) return response(401, { error: 'Cloudflare Access authentication is required.' });

  let keys = keySets.get(team);

  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`));

    keySets.set(team, keys);
  }

  try {
    await jwtVerify(token, keys, {
      algorithms: ['RS256'],
      audience,
      issuer: `https://${team}`,
      requiredClaims: ['exp', 'iat'],
    });
  } catch (error) {
    if (error instanceof errors.JOSEError) {
      return response(401, { error: 'Cloudflare Access authentication is invalid or expired.' });
    }

    console.error('Report authentication could not be verified.');

    return response(503, { error: 'Report authentication is temporarily unavailable.' });
  }

  return null;
}

export function isReportPath(path: string): boolean {
  return (
    path === '/diagnostics' || path.startsWith('/diagnostics/') || path === '/diagnostics.html'
  );
}

export async function serveReports(
  request: Request,
  environment: ReportEnvironment,
): Promise<Response> {
  const denied = await authorize(request, environment);

  if (denied) return denied;

  const bucket = environment.REPORTS;

  if (!bucket) throw new Error('Report storage was removed after authorization.');

  const url = new URL(request.url);
  const base = '/diagnostics/api/reports';

  if (
    url.pathname === '/diagnostics' ||
    url.pathname === '/diagnostics/' ||
    url.pathname === '/diagnostics.html'
  ) {
    if (request.method !== 'GET') return response(405, { error: 'Method not allowed.' });

    const page = await environment.ASSETS.fetch(
      new Request(new URL('/diagnostics.html', url), request),
    );
    const headers = new Headers(page.headers);

    headers.set('Cache-Control', 'no-store');

    return new Response(page.body, { headers, status: page.status });
  }

  if (request.method === 'POST' || request.method === 'DELETE') {
    if (request.headers.get('Origin') !== url.origin) {
      return response(403, { error: 'A same-origin request is required.' });
    }
  }

  if (url.pathname === base && request.method === 'POST') {
    if (request.headers.get('Content-Type') !== 'application/json') {
      return response(415, { error: 'Only numerical JSON reports are accepted.' });
    }

    if (!request.body) return response(400, { error: 'A report body is required.' });

    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;

    while (true) {
      const chunk = await reader.read();

      if (chunk.done) break;

      length += chunk.value.byteLength;

      if (length > MAX_REPORT_BYTES) {
        await reader.cancel();

        return response(413, { error: 'Report exceeds the size limit.' });
      }

      chunks.push(chunk.value);
    }

    const bytes = new Uint8Array(length);
    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);

      offset += chunk.byteLength;
    }

    let report: unknown;

    try {
      report = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      return response(400, { error: 'Report is not valid JSON.' });
    }

    if (!isDiagnosticReport(report))
      return response(400, { error: 'Report does not match the numerical schema.' });

    const id = crypto.randomUUID();
    const now = Date.now();

    await bucket.put(`reports/${id}`, JSON.stringify(report), {
      customMetadata: {
        environment: environment.DEPLOYMENT_ENVIRONMENT ?? '',
        expires: String(now + REPORT_RETENTION_MS),
        uploaded: String(now),
      },
      httpMetadata: { contentType: 'application/json' },
    });

    return response(201, { expires: now + REPORT_RETENTION_MS, id });
  }

  if (url.pathname === base && request.method === 'GET') {
    const cursor = url.searchParams.get('cursor') ?? undefined;
    const stored = await bucket.list({
      cursor,
      include: ['customMetadata'],
      limit: 50,
      prefix: 'reports/',
    });

    return response(200, {
      cursor: stored.truncated ? stored.cursor : null,
      reports: stored.objects
        .filter((object) => expires(object) > Date.now())
        .map((object) => ({
          expires: expires(object),
          id: object.key.slice('reports/'.length),
        })),
    });
  }

  const id = url.pathname.startsWith(`${base}/`) ? url.pathname.slice(base.length + 1) : '';

  if (!idPattern.test(id)) return response(404, { error: 'Report not found.' });

  if (request.method !== 'GET' && request.method !== 'DELETE') {
    return response(405, { error: 'Method not allowed.' });
  }

  const key = `reports/${id}`;
  const stored = await bucket.get(key);

  if (!stored || !Number.isFinite(expires(stored)) || expires(stored) <= Date.now()) {
    if (stored) await bucket.delete(key);

    return response(404, { error: 'Report not found or expired.' });
  }

  if (request.method === 'DELETE') {
    await bucket.delete(key);

    return response(200, { deleted: true });
  }

  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="calibration-${id}.json"`,
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
  });

  return new Response(await stored.text(), { headers });
}

export async function purgeReports(environment: ReportEnvironment): Promise<void> {
  if (!environment.REPORTS) return;

  let cursor: string | undefined;

  do {
    const result = await environment.REPORTS.list({
      cursor,
      include: ['customMetadata'],
      limit: 1000,
      prefix: 'reports/',
    });

    for (const object of result.objects) {
      if (!Number.isFinite(expires(object)) || expires(object) <= Date.now()) {
        await environment.REPORTS.delete(object.key);
      }
    }

    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
}
