import type { JWTPayload } from 'jose';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AccessConfiguration, Database } from '../src/access';
import {
  AccessError,
  authenticate,
  csrfToken,
  InfrastructureError,
  preferences,
  validateBoard,
} from '../src/access';
import { defaultBoard } from '../src/store';

const configuration = {
  ACCESS_AUD: 'a'.repeat(64),
  ACCESS_TEAM_DOMAIN: 'unit-tests.cloudflareaccess.com',
};
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let wrongKeys: Awaited<ReturnType<typeof generateKeyPair>>;
const now = Math.floor(Date.now() / 1000);

async function token(claims: JWTPayload = {}, key = keys.privateKey): Promise<string> {
  return new SignJWT({
    aud: configuration.ACCESS_AUD,
    email: 'caregiver@example.com',
    exp: now + 3600,
    iat: now - 1,
    iss: `https://${configuration.ACCESS_TEAM_DOMAIN}`,
    sub: 'human-subject',
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .sign(key);
}

function request(assertion?: string): Request {
  return new Request('https://reader.example/api/session', {
    headers: assertion ? { 'cf-access-jwt-assertion': assertion } : {},
  });
}

describe('Cloudflare Access identity verification', () => {
  beforeAll(async () => {
    keys = await generateKeyPair('RS256', { extractable: true });

    wrongKeys = await generateKeyPair('RS256');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('validates real RS256 signatures with only the configured HTTPS JWKS', async () => {
    const jwk = { ...(await exportJWK(keys.publicKey)), alg: 'RS256', kid: 'test-key' };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ keys: [jwk] }));

    vi.stubGlobal('fetch', fetch);

    expect(await authenticate(request(await token()), configuration)).toEqual({
      email: 'caregiver@example.com',
      subject: 'human-subject',
    });

    expect(fetch.mock.calls[0]?.[0]).toBe(
      'https://unit-tests.cloudflareaccess.com/cdn-cgi/access/certs',
    );

    expect(await authenticate(request(await token()), configuration)).toHaveProperty(
      'subject',
      'human-subject',
    );

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects forged, wrong issuer/audience, expired, premature and malformed assertions', async () => {
    const assertions = [
      'not-a-jwt',
      await token({}, wrongKeys.privateKey),
      await token({ iss: 'https://attacker.example' }),
      await token({ aud: 'b'.repeat(64) }),
      await token({ exp: now - 1 }),
      await token({ nbf: now + 3600 }),
      await token({ iat: now + 3600 }),
      await token({ exp: undefined }),
      await token({ iat: undefined }),
      await token({ sub: undefined }),
      await token({ iat: 1.5 }),
      await token({ exp: now + 3600.5 }),
      await token({ exp: now + 3600, iat: now + 3600 }),
      await new SignJWT({ sub: 'human-subject' })
        .setProtectedHeader({ alg: 'HS256' })
        .sign(new TextEncoder().encode('a'.repeat(64))),
      await new SignJWT({
        aud: configuration.ACCESS_AUD,
        exp: now + 3600,
        iat: now - 1,
        iss: `https://${configuration.ACCESS_TEAM_DOMAIN}`,
        sub: 'human-subject',
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'unknown-key' })
        .sign(keys.privateKey),
    ];
    const fetch = vi.fn<typeof globalThis.fetch>();

    vi.stubGlobal('fetch', fetch);

    for (const assertion of assertions) {
      await expect(authenticate(request(assertion), configuration)).rejects.toMatchObject({
        status: 401,
      });
    }

    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires human email and subject, rejecting service claims even if email is present', async () => {
    for (const claims of [
      { email: undefined },
      { email: 123 },
      { email: 'not-an-email' },
      { email: `${'a'.repeat(250)}@example.com` },
      { sub: '' },
      { sub: '  ' },
      { sub: 'a'.repeat(257) },
      { common_name: 'automation' },
      { service_token_id: 'automation' },
      { service_token_status: true },
      { service_token: 'automation' },
      { type: 'service' },
    ]) {
      await expect(authenticate(request(await token(claims)), configuration)).rejects.toMatchObject(
        {
          status: 401,
        },
      );
    }
  });

  it('fails closed on invalid configuration and ignores unverified identity/service headers', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();

    vi.stubGlobal('fetch', fetch);

    for (const config of [
      {},
      { ...configuration, ACCESS_TEAM_DOMAIN: undefined },
      { ...configuration, ACCESS_AUD: undefined },
      { ...configuration, ACCESS_AUD: 'REPLACE_WITH_TEST_ACCESS_AUD' },
      ...[
        'https://unit-tests.cloudflareaccess.com',
        'unit-tests.cloudflareaccess.com/attack',
        'unit-tests.cloudflareaccess.com.attacker.example',
        'attacker.example',
        'user@unit-tests.cloudflareaccess.com',
        'unit-tests.cloudflareaccess.com:443',
      ].map((domain) => ({ ...configuration, ACCESS_TEAM_DOMAIN: domain })),
    ]) {
      await expect(authenticate(request(await token()), config)).rejects.toMatchObject({
        status: 503,
      });
    }

    await expect(
      authenticate(
        new Request('https://reader.example/api/session', {
          headers: {
            'cf-access-authenticated-user-email': 'caregiver@example.com',
            'cf-access-client-id': 'service-id',
            'cf-access-client-secret': 'service-secret',
          },
        }),
        configuration,
      ),
    ).rejects.toMatchObject({ status: 401 });

    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports unreachable or malformed key services only as generic infrastructure errors', async () => {
    for (const [index, response] of [
      new Error('private infrastructure details'),
      new Response('private upstream body', { status: 503 }),
      Response.json({ notKeys: [] }),
    ].entries()) {
      const fetch = vi.fn<typeof globalThis.fetch>();
      const config: AccessConfiguration = {
        ...configuration,
        ACCESS_TEAM_DOMAIN: `failure-${index}.cloudflareaccess.com`,
      };

      if (response instanceof Error) {
        fetch.mockRejectedValue(response);
      } else {
        fetch.mockResolvedValue(response);
      }

      vi.stubGlobal('fetch', fetch);

      await expect(
        authenticate(request(await token({ iss: `https://${config.ACCESS_TEAM_DOMAIN}` })), config),
      ).rejects.toEqual(new InfrastructureError('access-key-service'));
    }
  });

  it('keeps CSRF stable across JWT renewal and separates subjects and environments', async () => {
    const identity = { email: 'caregiver@example.com', subject: 'human-subject' };
    const first = await csrfToken(identity, configuration);
    const renewed = await authenticate(request(await token({ exp: now + 7200 })), configuration);

    expect(first).toMatch(/^[a-f0-9]{64}$/);

    expect(await csrfToken(renewed, configuration)).toBe(first);

    expect(await csrfToken({ ...identity, email: 'renamed@example.com' }, configuration)).toBe(
      first,
    );

    expect(await csrfToken({ ...identity, subject: 'other' }, configuration)).not.toBe(first);

    expect(await csrfToken(identity, { ...configuration, ACCESS_AUD: 'b'.repeat(64) })).not.toBe(
      first,
    );
  });
});

describe('preference and board guards', () => {
  it('makes a missing post-initialization row an infrastructure failure', async () => {
    const statement = {
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
    };
    const db: Database = { prepare: vi.fn().mockReturnValue(statement) };

    await expect(
      preferences(db, { email: 'caregiver@example.com', subject: 'human-subject' }),
    ).rejects.toEqual(new InfrastructureError('database-operation'));
  });

  it('validates boards without resetting their order and bounds phrases and IDs', () => {
    const board = defaultBoard();
    const tooMany = {
      ...board,
      phrases: [
        ...board.phrases,
        ...Array.from({ length: 257 - board.phrases.length }, (_, index) => ({
          id: `p${index}`,
          text: `phrase ${index}`,
        })),
      ],
    };
    const longId = 'a'.repeat(129);
    const longIds = {
      ...board,
      phrases: [{ id: longId, text: 'Uma frase' }, ...board.phrases],
    };

    expect(validateBoard(board)).toEqual(board);

    for (const value of [undefined, 'a'.repeat(64_001), {}, tooMany, longIds]) {
      expect(() => validateBoard(value)).toThrow(AccessError);
    }
  });
});
