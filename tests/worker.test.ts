import type { JWTPayload } from 'jose';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
const assets = { fetch: vi.fn<(request: Request) => Promise<Response>>() };
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

    await db.exec(
      readFileSync(new URL('../migrations/0001_accounts.sql', import.meta.url), 'utf8').replaceAll(
        '\n',
        ' ',
      ),
    );

    await db
      .prepare(
        'INSERT INTO accounts (id, username, password_hash, board, revision) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(
        'legacy-id',
        'legacy-user',
        'never-archive-this-hash',
        JSON.stringify(defaultBoard()),
        7,
      )
      .run();

    await db
      .prepare('INSERT INTO account_tokens (token_hash, account_id, expires_at) VALUES (?, ?, ?)')
      .bind('legacy-token', 'legacy-id', now + 3600)
      .run();

    await db
      .prepare(
        'INSERT INTO sessions (id, account_id, auth_version, token_hash, csrf, rotation_key, renewed_at, expires_at) VALUES (?, ?, 0, ?, ?, ?, ?, ?)',
      )
      .bind(
        'legacy-session',
        'legacy-id',
        'legacy-token',
        'legacy-csrf',
        'legacy-key',
        now,
        now + 3600,
      )
      .run();

    await db.exec(
      readFileSync(
        new URL('../migrations/0002_cloudflare_access.sql', import.meta.url),
        'utf8',
      ).replaceAll('\n', ' '),
    );

    keys = await generateKeyPair('RS256', { extractable: true });

    assertion = await sign();
  }, 30_000);

  beforeEach(async () => {
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

  it('archives existing boards without credentials and removes obsolete tables in FK-safe order', async () => {
    expect(
      await db.prepare('SELECT * FROM legacy_board_archive WHERE id = ?').bind('legacy-id').first(),
    ).toEqual({
      board: JSON.stringify(defaultBoard()),
      id: 'legacy-id',
      revision: 7,
      username: 'legacy-user',
    });

    for (const table of ['accounts', 'sessions', 'account_tokens', 'login_limits']) {
      expect(
        await db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .bind(table)
          .first(),
      ).toBeNull();
    }

    await expect(
      db.prepare('INSERT INTO user_preferences VALUES (?, ?, -1)').bind('bad', '{}').run(),
    ).rejects.toThrow(/CHECK/);
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

    expect(log).toHaveBeenLastCalledWith('Access request failed', {
      category: 'database-operation',
      errorType: 'Error',
      operation: '/api/session',
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

    expect(log).toHaveBeenLastCalledWith('Access request failed', {
      category: 'access-key-service',
      errorType: 'Error',
      operation: '/api/session',
    });

    const customError = new Error(secret);

    customError.name = secret;

    assets.fetch.mockRejectedValue(customError);

    const assetResponse = await request(`/unknown?${secret}`);

    expect(assetResponse.status).toBe(503);

    expect(log).toHaveBeenLastCalledWith('Access request failed', {
      category: 'unexpected-operation',
      errorType: 'other',
      operation: 'other',
    });

    assets.fetch.mockRejectedValue(secret);

    expect((await request('/')).status).toBe(503);

    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  });
});
