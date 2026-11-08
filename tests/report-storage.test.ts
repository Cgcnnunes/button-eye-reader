import type * as Jose from 'jose';
import { errors } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticCapture, MAX_REPORT_BYTES, REPORT_RETENTION_MS } from '../src/diagnostics';
import {
  isReportPath,
  purgeReports,
  type ReportEnvironment,
  serveReports,
} from '../src/report-storage';
import worker from '../src/worker';

const mocks = vi.hoisted(() => ({ verify: vi.fn<() => Promise<unknown>>() }));

vi.mock('jose', async (original) => ({
  ...(await original<typeof Jose>()),
  jwtVerify: mocks.verify,
}));

const id = '11111111-1111-4111-8111-111111111111';
const bucket = {
  delete: vi.fn<(key: string) => Promise<void>>(),
  get: vi.fn<NonNullable<ReportEnvironment['REPORTS']>['get']>(),
  list: vi.fn<NonNullable<ReportEnvironment['REPORTS']>['list']>(),
  put: vi.fn<NonNullable<ReportEnvironment['REPORTS']>['put']>(),
};
const assets = vi.fn<(request: Request) => Promise<Response>>();
const environment: ReportEnvironment = {
  ASSETS: { fetch: assets },
  DEPLOYMENT_ENVIRONMENT: 'production',
  REPORT_ACCESS_AUD: 'reports-audience',
  REPORT_ACCESS_TEAM: 'reader.cloudflareaccess.com',
  REPORTS: bucket,
};

function request(path = '', method = 'GET', body?: string): Request {
  return new Request(`https://reader.example/diagnostics/api/reports${path}`, {
    body,
    headers: {
      'Cf-Access-Jwt-Assertion': 'signed-token',
      'Content-Type': 'application/json',
      Origin: 'https://reader.example',
    },
    method,
  });
}

function stored(expiry = Date.now() + REPORT_RETENTION_MS): {
  customMetadata: { expires: string };
  key: string;
  size: number;
  text: () => Promise<string>;
} {
  return {
    customMetadata: { expires: String(expiry) },
    key: `reports/${id}`,
    size: 2,
    text: () => Promise.resolve('{}'),
  };
}

describe('private numerical report storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.verify.mockResolvedValue({});

    bucket.put.mockResolvedValue(null);

    bucket.delete.mockResolvedValue(undefined);

    bucket.get.mockResolvedValue(stored());

    bucket.list.mockResolvedValue({ objects: [], truncated: false });

    assets.mockImplementation(() => Promise.resolve(new Response('private page')));
  });

  it('fails closed when storage/auth settings are missing and preserves the public board', async () => {
    const response = await worker.fetch(new Request('https://reader.example/diagnostics'), {
      ASSETS: { fetch: assets },
    });

    expect(response.status).toBe(503);

    expect(assets).not.toHaveBeenCalled();

    const publicResponse = await worker.fetch(new Request('https://reader.example/'), environment);

    expect(await publicResponse.text()).toBe('private page');

    expect(mocks.verify).not.toHaveBeenCalled();

    expect(isReportPath('/diagnostics.html')).toBe(true);

    expect(isReportPath('/diagnostics/api/reports')).toBe(true);

    expect(isReportPath('/diagnostics-other')).toBe(false);
  });

  it('requires a signed Access token and reports verification outages explicitly', async () => {
    expect(
      (await serveReports(new Request('https://reader.example/diagnostics'), environment)).status,
    ).toBe(401);

    mocks.verify.mockRejectedValue(new errors.JWTExpired('expired', {}));

    expect((await serveReports(request(), environment)).status).toBe(401);

    mocks.verify.mockRejectedValue(new Error('network'));

    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect((await serveReports(request(), environment)).status).toBe(503);

    expect(log).toHaveBeenCalledWith('Report authentication could not be verified.');
  });

  it.each(['/diagnostics', '/diagnostics/', '/diagnostics.html'])(
    'authenticates private page %s before serving assets',
    async (path) => {
      const incoming = request();
      const response = await serveReports(
        new Request(`https://reader.example${path}`, incoming),
        environment,
      );

      expect(await response.text()).toBe('private page');

      expect(response.headers.get('cache-control')).toBe('no-store');

      expect(mocks.verify).toHaveBeenCalledWith(
        'signed-token',
        expect.any(Function),
        expect.objectContaining({
          algorithms: ['RS256'],
          audience: 'reports-audience',
          issuer: 'https://reader.cloudflareaccess.com',
        }),
      );

      expect(
        (
          await serveReports(
            new Request(`https://reader.example${path}`, {
              headers: incoming.headers,
              method: 'POST',
            }),
            environment,
          )
        ).status,
      ).toBe(405);
    },
  );

  it('stores only valid numerical reports with server-controlled expiry', async () => {
    const report = new DiagnosticCapture('0.3.4', 1180, 820, 0).finish('cancelled', 1000);
    const before = Date.now();
    const response = await serveReports(request('', 'POST', JSON.stringify(report)), environment);

    expect(response.status).toBe(201);

    expect(bucket.put).toHaveBeenCalledOnce();

    const options = bucket.put.mock.calls[0][2];

    expect(Number(options.customMetadata.expires)).toBeGreaterThanOrEqual(
      before + REPORT_RETENTION_MS,
    );

    expect(options.customMetadata.environment).toBe('production');

    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects cross-origin, non-JSON, empty, oversized and unexpected report data', async () => {
    const cross = request('', 'POST', '{}');

    cross.headers.set('Origin', 'https://other.example');

    expect((await serveReports(cross, environment)).status).toBe(403);

    const wrongType = request('', 'POST', '{}');

    wrongType.headers.set('Content-Type', 'text/plain');

    expect((await serveReports(wrongType, environment)).status).toBe(415);

    expect((await serveReports(request('', 'POST'), environment)).status).toBe(400);

    expect(
      (await serveReports(request('', 'POST', 'x'.repeat(MAX_REPORT_BYTES + 1)), environment))
        .status,
    ).toBe(413);

    expect((await serveReports(request('', 'POST', '{'), environment)).status).toBe(400);

    expect(
      (await serveReports(request('', 'POST', '{"image":"private"}'), environment)).status,
    ).toBe(400);

    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('lists only unexpired reports and preserves pagination', async () => {
    const current = stored();

    bucket.list.mockResolvedValue({
      cursor: 'next-page',
      objects: [current, stored(0)],
      truncated: true,
    });

    const result: unknown = await (await serveReports(request('?cursor=page'), environment)).json();

    expect(result).toEqual({
      cursor: 'next-page',
      reports: [{ expires: Number(current.customMetadata.expires), id }],
    });

    expect(bucket.list).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 'page', limit: 50 }),
    );
  });

  it('downloads private JSON and deletes explicitly requested reports', async () => {
    const download = await serveReports(request(`/${id}`), environment);

    expect(await download.text()).toBe('{}');

    expect(download.headers.get('content-disposition')).toContain(`calibration-${id}.json`);

    expect((await serveReports(request(`/${id}`, 'DELETE'), environment)).status).toBe(200);

    expect(bucket.delete).toHaveBeenCalledWith(`reports/${id}`);
  });

  it('rejects missing/expired IDs and unsupported methods', async () => {
    expect((await serveReports(request('/invalid'), environment)).status).toBe(404);

    expect((await serveReports(request(`/${id}`, 'PUT'), environment)).status).toBe(405);

    bucket.get.mockResolvedValue(null);

    expect((await serveReports(request(`/${id}`), environment)).status).toBe(404);

    bucket.get.mockResolvedValue(stored(0));

    expect((await serveReports(request(`/${id}`), environment)).status).toBe(404);

    expect(bucket.delete).toHaveBeenCalledWith(`reports/${id}`);
  });

  it('purges expired objects across pages and leaves unexpired reports', async () => {
    bucket.list
      .mockResolvedValueOnce({ cursor: 'next-page', objects: [stored(0)], truncated: true })
      .mockResolvedValueOnce({ objects: [stored()], truncated: false });

    await worker.scheduled({}, environment);

    expect(bucket.delete).toHaveBeenCalledTimes(1);

    expect(bucket.list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'next-page' }));

    await purgeReports({ ASSETS: { fetch: assets } });
  });
});
