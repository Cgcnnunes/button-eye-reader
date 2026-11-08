import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportEnvironment } from '../src/report-storage';

describe('real Access signature verification', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts only a correctly signed token for the report audience and issuer', async () => {
    const keys = await generateKeyPair('RS256');
    const wrongKeys = await generateKeyPair('RS256');
    const jwk = await exportJWK(keys.publicKey);
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json({
        keys: [{ ...jwk, alg: 'RS256', kid: 'test-key', use: 'sig' }],
      }),
    );

    vi.stubGlobal('fetch', fetch);

    const { serveReports } = await import('../src/report-storage');
    const environment: ReportEnvironment = {
      ASSETS: { fetch: () => Promise.resolve(new Response('private')) },
      DEPLOYMENT_ENVIRONMENT: 'test',
      REPORT_ACCESS_AUD: 'reports',
      REPORT_ACCESS_TEAM: 'reader.cloudflareaccess.com',
      REPORTS: {
        delete: () => Promise.resolve(),
        get: () => Promise.resolve(null),
        list: () => Promise.resolve({ objects: [], truncated: false }),
        put: () => Promise.resolve(null),
      },
    };

    for (const scenario of [
      'valid',
      'wrong-audience',
      'wrong-issuer',
      'expired',
      'wrong-signature',
    ]) {
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer(
          scenario === 'wrong-issuer'
            ? 'https://other.cloudflareaccess.com'
            : 'https://reader.cloudflareaccess.com',
        )
        .setAudience(scenario === 'wrong-audience' ? 'board' : 'reports')
        .setIssuedAt()
        .setExpirationTime(scenario === 'expired' ? 1 : '5m')
        .sign(scenario === 'wrong-signature' ? wrongKeys.privateKey : keys.privateKey);
      const response = await serveReports(
        new Request('https://reader.example/diagnostics', {
          headers: { 'Cf-Access-Jwt-Assertion': token },
        }),
        environment,
      );

      expect(response.status, scenario).toBe(scenario === 'valid' ? 200 : 401);
    }

    expect(fetch.mock.calls[0][0]).toEqual(
      'https://reader.cloudflareaccess.com/cdn-cgi/access/certs',
    );
  });
});
