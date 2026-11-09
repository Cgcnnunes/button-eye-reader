import type { JWTPayload } from 'jose';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/access';
import { defaultBoard } from '../src/store';
import * as workerModule from '../src/worker';
import worker from '../src/worker';

const origin = 'https://reader.example';
const config = {
  ACCESS_AUD: 'a'.repeat(64),
  ACCESS_TEAM_DOMAIN: 'worker-tests.cloudflareaccess.com',
};
const now = Math.floor(Date.now() / 1000);
const baseline = readFileSync(
  new URL('../migrations/0001_user_preferences.sql', import.meta.url),
  'utf8',
).replaceAll('\n', ' ');
const assets = { fetch: vi.fn<(request: Request) => Promise<Response>>() };
const validDuration = {
  asymmetricMatch(value: unknown): boolean {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  },
};
let runtime: Miniflare;
let db: Database & { exec(sql: string): Promise<unknown> };
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let assertion = '';
let csrf = '';

async function sign(claims: JWTPayload = {}): Promise<string> {
  return new SignJWT({
    aud: config.ACCESS_AUD,
    email: 'caregiver@example.com',
    exp: now + 3600,
    iat: now - 1,
    iss: `https://${config.ACCESS_TEAM_DOMAIN}`,
    sub: 'caregiver-subject',
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'worker-test-key' })
    .sign(keys.privateKey);
}

async function request(
  path: string,
  options: RequestInit = {},
  jwt = assertion,
): Promise<Response> {
  const headers = new Headers(options.headers);

  if (jwt) {
    headers.set('cf-access-jwt-assertion', jwt);
  }

  return worker.fetch(new Request(`${origin}${path}`, { ...options, headers }), {
    ...config,
    ASSETS: assets,
    DB: db,
  });
}

function payload(value: unknown): RequestInit {
  return {
    body: JSON.stringify(value),
    headers: {
      'content-type': 'application/json',
      origin,
      'x-csrf-token': csrf,
    },
    method: 'PUT',
  };
}

describe('Access Worker with signed JWTs and real local D1', () => {
  beforeAll(async () => {
    runtime = new Miniflare(
      convertV4MiniflareOptions({
        compatibilityDate: '2026-11-07',
        d1Databases: { DB: 'access-worker-tests' },
        modules: true,
        script: 'export default {fetch(){return new Response("ready")}}',
      }),
    );

    const bindings = await runtime.getBindings<{ DB: typeof db }>();

    db = bindings.DB;

    await db.exec(baseline);

    keys = await generateKeyPair('RS256', { extractable: true });

    assertion = await sign();
  }, 30_000);

  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    assets.fetch.mockImplementation(() => Promise.resolve(new Response('asset')));

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        Response.json({
          keys: [{ ...(await exportJWK(keys.publicKey)), alg: 'RS256', kid: 'worker-test-key' }],
        }),
      ),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    vi.unstubAllGlobals();

    await runtime.dispose();
  });

  it('exports only the Worker handler and serves edge-protected assets, including automation', async () => {
    expect(Object.keys(workerModule)).toEqual(['default']);

    for (const path of ['/', '/index.html', '/app', '/app/board', '/assets/app.js']) {
      const response = await request(
        path,
        { headers: { 'cf-access-client-id': 'automation' } },
        '',
      );

      expect(await response.text()).toBe('asset');

      expect(response.headers.get('permissions-policy')).toContain('camera=()');

      expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");

      expect(response.headers.get('cache-control')).toBe('no-store');

      expect(response.headers.get('referrer-policy')).toBe('no-referrer');

      expect(response.headers.get('x-content-type-options')).toBe('nosniff');

      expect(response.headers.get('x-frame-options')).toBe('DENY');

      expect(response.headers.has('set-cookie')).toBe(false);
    }
  });

  it('builds only the current application schema with required defaults and constraints', async () => {
    expect(readdirSync(new URL('../migrations/', import.meta.url))).toEqual([
      '0001_user_preferences.sql',
    ]);

    expect(
      await db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
        )
        .run(),
    ).toMatchObject({ results: [{ name: 'user_preferences' }] });

    expect(await db.prepare('PRAGMA table_info(user_preferences)').run()).toMatchObject({
      results: [
        { cid: 0, dflt_value: null, name: 'access_subject', notnull: 1, pk: 1, type: 'TEXT' },
        { cid: 1, dflt_value: null, name: 'board', notnull: 1, pk: 0, type: 'TEXT' },
        { cid: 2, dflt_value: '0', name: 'revision', notnull: 1, pk: 0, type: 'INTEGER' },
      ],
    });

    await db
      .prepare('INSERT INTO user_preferences (access_subject, board) VALUES (?, ?)')
      .bind('schema-default', JSON.stringify(defaultBoard()))
      .run();

    expect(
      await db
        .prepare('SELECT revision FROM user_preferences WHERE access_subject = ?')
        .bind('schema-default')
        .first(),
    ).toEqual({ revision: 0 });

    await expect(
      db.prepare('INSERT INTO user_preferences VALUES (?, ?, -1)').bind('bad', '{}').run(),
    ).rejects.toThrow(/CHECK/);

    await expect(
      db.prepare('INSERT INTO user_preferences VALUES (NULL, ?, 0)').bind('{}').run(),
    ).rejects.toThrow(/NOT NULL/);

    await expect(
      db.prepare('INSERT INTO user_preferences VALUES (?, NULL, 0)').bind('bad').run(),
    ).rejects.toThrow(/NOT NULL/);

    await expect(
      db.prepare('INSERT INTO user_preferences VALUES (?, ?, NULL)').bind('bad', '{}').run(),
    ).rejects.toThrow(/NOT NULL/);

    await expect(
      db
        .prepare('INSERT INTO user_preferences VALUES (?, ?, 0)')
        .bind('schema-default', '{}')
        .run(),
    ).rejects.toThrow(/UNIQUE/);

    await db
      .prepare('DELETE FROM user_preferences WHERE access_subject = ?')
      .bind('schema-default')
      .run();
  });

  it('reapplying the current schema preserves saved boards and revisions', async () => {
    const board = JSON.stringify(defaultBoard());

    await db
      .prepare('INSERT INTO user_preferences (access_subject, board, revision) VALUES (?, ?, ?)')
      .bind('baseline-preserved-subject', board, 7)
      .run();

    await db.exec(baseline);

    await db.exec(baseline);

    expect(
      await db
        .prepare('SELECT board, revision FROM user_preferences WHERE access_subject = ?')
        .bind('baseline-preserved-subject')
        .first(),
    ).toEqual({ board, revision: 7 });

    await db
      .prepare('DELETE FROM user_preferences WHERE access_subject = ?')
      .bind('baseline-preserved-subject')
      .run();
  });

  it('fails closed without D1/Access configuration or a human signed assertion', async () => {
    for (const environment of [
      { ...config, ASSETS: assets },
      { ASSETS: assets, DB: db },
      { ...config, ACCESS_AUD: 'REPLACE_WITH_TEST_ACCESS_AUD', ASSETS: assets, DB: db },
    ]) {
      expect((await worker.fetch(new Request(`${origin}/api/session`), environment)).status).toBe(
        503,
      );
    }

    for (const jwt of [
      '',
      'forged',
      await sign({ exp: now - 1 }),
      await sign({ common_name: 'service' }),
      await sign({ email: undefined }),
      await sign({ aud: 'b'.repeat(64) }),
    ]) {
      const response = await request(
        '/api/session',
        {
          headers: {
            accept: 'text/html',
            'cf-access-authenticated-user-email': 'caregiver@example.com',
            cookie: '__Host-reader=old-cookie',
          },
        },
        jwt,
      );

      expect(response.status).toBe(401);

      expect(response.headers.has('location')).toBe(false);

      expect(response.headers.get('content-type')).toContain('application/json');

      expect(Object.keys((await response.json()) as Record<string, unknown>)).toEqual(['error']);
    }

    expect(
      await db.prepare('SELECT access_subject FROM user_preferences LIMIT 1').first(),
    ).toBeNull();

    expect(
      (
        await worker.fetch(
          new Request('http://reader.example/api/session', {
            headers: { 'cf-access-jwt-assertion': assertion },
          }),
          { ...config, ASSETS: assets, DB: db },
        )
      ).status,
    ).toBe(403);
  });

  it('initializes once per Access subject, preserves API shape and survives JWT rotation', async () => {
    const sessions = await Promise.all([request('/api/session'), request('/api/session')]);

    for (const response of sessions) {
      expect(response.status).toBe(200);

      expect(response.headers.has('set-cookie')).toBe(false);

      const session = (await response.json()) as {
        board: unknown;
        csrf: string;
        revision: number;
        username: string;
      };

      expect(session).toEqual({
        board: defaultBoard(),
        csrf: session.csrf,
        revision: 0,
        username: 'caregiver@example.com',
      });

      expect(session.csrf).toMatch(/^[a-f0-9]{64}$/);

      csrf = session.csrf;
    }

    const renewed = await request('/api/session', {}, await sign({ exp: now + 7200 }));

    expect(await renewed.json()).toHaveProperty('csrf', csrf);

    const local = await worker.fetch(
      new Request('http://localhost:8787/api/session', {
        headers: { 'cf-access-jwt-assertion': assertion },
      }),
      { ...config, ASSETS: assets, DB: db },
    );

    expect(local.status).toBe(200);

    expect(
      (
        await worker.fetch(new Request('http://localhost:8787/api/session'), {
          ...config,
          ASSETS: assets,
          DB: db,
        })
      ).status,
    ).toBe(401);
  });

  it('has no custom login/setup/logout APIs and only accepts the documented methods', async () => {
    for (const path of ['/api/login', '/api/setup', '/api/logout', '/api', '/api/unknown']) {
      expect((await request(path, { method: 'POST' })).status).toBe(404);
    }

    for (const [path, method] of [
      ['/api/session', 'POST'],
      ['/api/session', 'DELETE'],
      ['/api/board', 'GET'],
      ['/api/board', 'POST'],
    ]) {
      expect((await request(path ?? '', { method })).status).toBe(405);
    }
  });

  it('requires exact same-origin, JSON and stable subject-bound CSRF for writes', async () => {
    const invalidHeaders: Record<string, string>[] = [
      { 'content-type': 'application/json', 'x-csrf-token': csrf },
      {
        'content-type': 'application/json',
        origin: 'https://attacker.example',
        'x-csrf-token': csrf,
      },
      {
        'content-type': 'application/json',
        origin,
        'sec-fetch-site': 'cross-site',
        'x-csrf-token': csrf,
      },
      { 'content-type': 'application/json', origin },
      { 'content-type': 'application/json', origin, 'x-csrf-token': 'wrong' },
    ];

    for (const headers of invalidHeaders) {
      expect(
        (
          await request('/api/board', {
            ...payload({ board: defaultBoard(), revision: 0 }),
            headers,
          })
        ).status,
      ).toBe(403);
    }

    expect(
      (
        await request('/api/board', {
          ...payload({}),
          headers: { origin, 'x-csrf-token': csrf },
        })
      ).status,
    ).toBe(415);

    expect(
      (
        await request('/api/board', {
          ...payload({}),
          body: null,
        })
      ).status,
    ).toBe(400);

    for (const body of ['{', '[]', 'null']) {
      expect((await request('/api/board', { ...payload({}), body })).status).toBe(400);
    }

    expect(
      (
        await request('/api/board', {
          ...payload({}),
          body: 'a'.repeat(70_001),
        })
      ).status,
    ).toBe(413);

    expect(
      (
        await request('/api/board', {
          ...payload({}),
          headers: {
            'content-length': '70001',
            'content-type': 'application/json',
            origin,
            'x-csrf-token': csrf,
          },
        })
      ).status,
    ).toBe(413);

    for (const revision of [-1, 0.5, '0', Number.MAX_SAFE_INTEGER, null]) {
      expect(
        (await request('/api/board', payload({ board: defaultBoard(), revision }))).status,
      ).toBe(400);
    }

    expect((await request('/api/board', payload({ board: {}, revision: 0 }))).status).toBe(400);
  });

  it('persists only successful revisions and isolates subjects even with matching emails', async () => {
    const board = defaultBoard();

    board.slots.reverse();

    const results = await Promise.all([
      request('/api/board', payload({ board, revision: 0 })),
      request('/api/board', payload({ board, revision: 0 })),
    ]);

    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);

    const saved = await request('/api/session');

    expect(await saved.json()).toEqual({
      board,
      csrf,
      revision: 1,
      username: 'caregiver@example.com',
    });

    const other = await sign({ sub: 'other-subject' });
    const otherSession = await request('/api/session', {}, other);
    const otherData = (await otherSession.json()) as { csrf: string };

    expect(otherData).toHaveProperty('board', defaultBoard());

    expect(otherData.csrf).not.toBe(csrf);

    expect((await request('/api/board', payload({ board, revision: 1 }), other)).status).toBe(403);

    const changedEmail = await request(
      '/api/session',
      {},
      await sign({ email: 'renamed@example.com' }),
    );

    expect(await changedEmail.json()).toEqual({
      board,
      csrf,
      revision: 1,
      username: 'renamed@example.com',
    });

    const renewed = await sign({ exp: now + 7200 });

    expect((await request('/api/board', payload({ board, revision: 1 }), renewed)).status).toBe(
      200,
    );
  });

  it('returns generic infrastructure failures and logs only privacy-safe categories', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secret = 'private-token-username-phrase-query';
    const badDatabase: Database = {
      prepare: () => {
        throw new Error(`D1_ERROR ${secret}`);
      },
    };
    const databaseResponse = await worker.fetch(
      new Request(`${origin}/api/session?${secret}`, {
        headers: { 'cf-access-jwt-assertion': assertion },
      }),
      { ...config, ASSETS: assets, DB: badDatabase },
    );

    expect(databaseResponse.status).toBe(503);

    expect(await databaseResponse.text()).not.toContain(secret);

    expect(log).toHaveBeenLastCalledWith({
      category: 'database-operation',
      durationMs: validDuration,
      errorType: 'Error',
      message: 'Worker request',
      operation: '/api/session',
      status: 503,
    });

    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error(secret)));

    const brokenKeys = { ...config, ACCESS_TEAM_DOMAIN: 'broken-worker.cloudflareaccess.com' };
    const keyResponse = await worker.fetch(
      new Request(`${origin}/api/session`, {
        headers: {
          'cf-access-jwt-assertion': await sign({
            iss: `https://${brokenKeys.ACCESS_TEAM_DOMAIN}`,
          }),
        },
      }),
      { ...brokenKeys, ASSETS: assets, DB: db },
    );

    expect(keyResponse.status).toBe(503);

    expect(log).toHaveBeenLastCalledWith({
      category: 'access-key-service',
      durationMs: validDuration,
      errorType: 'Error',
      message: 'Worker request',
      operation: '/api/session',
      status: 503,
    });

    const customError = new Error(secret);

    customError.name = secret;

    assets.fetch.mockRejectedValue(customError);

    const assetResponse = await request(`/unknown?${secret}`);

    expect(assetResponse.status).toBe(503);

    expect(log).toHaveBeenLastCalledWith({
      category: 'unexpected-operation',
      durationMs: validDuration,
      errorType: 'other',
      message: 'Worker request',
      operation: 'other',
      status: 503,
    });

    assets.fetch.mockRejectedValue(secret);

    expect((await request('/')).status).toBe(503);

    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  });

  it('logs one safe success per API request, including saves, without successful asset noise', async () => {
    const secret = 'private-query-cookie-phrase';
    const session = await request(`/api/session?${secret}`, {
      headers: { cookie: secret, 'user-agent': secret, 'x-forwarded-for': '192.0.2.1' },
    });

    expect(session.status).toBe(200);

    expect(console.info).toHaveBeenCalledExactlyOnceWith({
      category: 'success',
      durationMs: validDuration,
      message: 'Worker request',
      operation: '/api/session',
      status: 200,
    });

    const saved = (await session.json()) as { board: unknown; csrf: string; revision: number };
    const result = await request('/api/board', {
      ...payload({ board: saved.board, revision: saved.revision }),
      headers: {
        'content-type': 'application/json',
        origin,
        'x-csrf-token': saved.csrf,
      },
    });

    expect(result.status).toBe(200);

    expect(console.info).toHaveBeenLastCalledWith({
      category: 'success',
      durationMs: validDuration,
      message: 'Worker request',
      operation: '/api/board',
      status: 200,
    });

    for (const path of ['/', '/assets/app.js', '/release.json']) await request(path);

    expect(console.info).toHaveBeenCalledTimes(2);

    expect(console.warn).not.toHaveBeenCalled();

    expect(console.error).not.toHaveBeenCalled();

    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toMatch(
      /private-query-cookie-phrase|caregiver@|caregiver-subject|192\.0\.2\.1|csrf|slots|phrases/,
    );
  });

  it('logs rejections, conflicts and unavailable configuration without identities or raw paths', async () => {
    expect((await request('/api/session', {}, '')).status).toBe(401);

    expect(console.warn).toHaveBeenLastCalledWith({
      category: 'request-rejected',
      durationMs: validDuration,
      message: 'Worker request',
      operation: '/api/session',
      status: 401,
    });

    expect((await request('/api/private-path?secret=private')).status).toBe(404);

    expect(console.warn).toHaveBeenLastCalledWith({
      category: 'request-rejected',
      durationMs: validDuration,
      message: 'Worker request',
      operation: 'other',
      status: 404,
    });

    expect(
      (await request('/api/board', payload({ board: defaultBoard(), revision: 99 }))).status,
    ).toBe(409);

    expect(console.warn).toHaveBeenLastCalledWith({
      category: 'save-conflict',
      durationMs: validDuration,
      message: 'Worker request',
      operation: '/api/board',
      status: 409,
    });

    vi.spyOn(performance, 'now').mockReturnValueOnce(100.2).mockReturnValueOnce(112.9);

    expect(
      (await worker.fetch(new Request(`${origin}/api/session`), { ASSETS: assets })).status,
    ).toBe(503);

    expect(console.error).toHaveBeenCalledExactlyOnceWith({
      category: 'service-unavailable',
      durationMs: 13,
      message: 'Worker request',
      operation: '/api/session',
      status: 503,
    });

    expect(console.warn).toHaveBeenCalledTimes(3);

    expect(console.info).not.toHaveBeenCalled();

    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private');
  });

  it('logs returned asset server failures once but not asset redirects or missing files', async () => {
    for (const status of [302, 404, 500, 503]) {
      assets.fetch.mockResolvedValue(new Response('asset', { status }));

      expect((await request('/private-asset?secret=private')).status).toBe(status);
    }

    expect(console.error).toHaveBeenCalledTimes(2);

    expect(console.error).toHaveBeenLastCalledWith({
      category: 'service-unavailable',
      durationMs: validDuration,
      message: 'Worker request',
      operation: 'other',
      status: 503,
    });

    expect(console.info).not.toHaveBeenCalled();

    expect(console.warn).not.toHaveBeenCalled();
  });
});
