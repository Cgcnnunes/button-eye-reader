import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/accounts';
import { digest, initialBoard, randomToken, RENEW_SECONDS, SESSION_SECONDS } from '../src/accounts';
import { defaultBoard } from '../src/store';
import * as workerModule from '../src/worker';
import worker from '../src/worker';

const origin = 'https://reader.example';
const COOKIE_NAME = '__Host-reader';
const assets = {
  fetch: vi
    .fn<(request: Request) => Promise<Response>>()
    .mockImplementation(() => Promise.resolve(new Response('asset'))),
};
let runtime: Miniflare;
let db: Database;
let invitation = '';
let cookie = '';
let csrf = '';
const start = 1_800_000_000;

async function request(
  path: string,
  options: RequestInit = {},
  withCookie = true,
): Promise<Response> {
  const headers = new Headers(options.headers);

  if (withCookie && cookie) {
    headers.set('cookie', cookie);
  }

  if (options.method && options.method !== 'GET') {
    headers.set('origin', origin);
  }

  return worker.fetch(new Request(`${origin}${path}`, { ...options, headers }), {
    ASSETS: assets,
    DB: db,
  });
}

function payload(value: unknown): Pick<RequestInit, 'body' | 'headers'> {
  return {
    body: JSON.stringify(value),
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
  };
}

async function issue(name: string, existing = false, expiry = start + 86400): Promise<string> {
  const token = randomToken();

  if (!existing) {
    await db
      .prepare('INSERT INTO accounts (id, username, board) VALUES (?, ?, ?)')
      .bind(name, name, initialBoard())
      .run();
  }

  await db
    .prepare(
      `INSERT INTO account_tokens (token_hash, account_id, expires_at) VALUES (?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at`,
    )
    .bind(await digest(token), name, expiry)
    .run();

  return token;
}

describe('account Worker with real local D1', () => {
  beforeAll(async () => {
    runtime = new Miniflare(
      convertV4MiniflareOptions({
        compatibilityDate: '2026-11-07',
        d1Databases: { DB: 'accounts-tests' },
        modules: true,
        script: 'export default {fetch(){return new Response("ready")}}',
      }),
    );

    const { DB: database } = await runtime.getBindings<{
      DB: Database & { exec(sql: string): Promise<unknown> };
    }>();

    db = database;

    await database.exec(
      readFileSync(new URL('../migrations/0001_accounts.sql', import.meta.url), 'utf8').replaceAll(
        '\n',
        ' ',
      ),
    );

    invitation = await issue('caregiver');
  }, 30_000);

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue((start + 1000) * 1000);
  });

  afterAll(async () => {
    await runtime.dispose();
  });

  it('exports only the Worker handler at runtime, as required by workerd', () => {
    expect(Object.keys(workerModule)).toEqual(['default']);
  });

  it('serves public assets with security headers, not a session or fake accounts', async () => {
    for (const path of ['/', '/index.html', '/assets/app.js']) {
      const response = await worker.fetch(new Request(`${origin}${path}`), { ASSETS: assets });

      expect(await response.text()).toBe('asset');

      expect(response.headers.get('permissions-policy')).toContain('camera=()');

      expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");

      expect(response.headers.get('cache-control')).toBe('no-store');

      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    }
  });

  it('fails closed without a binding and refuses insecure remote HTTP', async () => {
    const absent = await worker.fetch(new Request(`${origin}/api/session`), { ASSETS: assets });

    expect(absent.status).toBe(503);

    const absentBody: unknown = await absent.json();

    expect(absentBody).toHaveProperty('error');

    const insecure = await worker.fetch(new Request('http://reader.example/api/session'), {
      ASSETS: assets,
      DB: db,
    });

    expect(insecure.status).toBe(403);

    expect((await request('/api/session', {}, false)).status).toBe(401);

    expect((await request('/app/board', {}, false)).status).toBe(401);

    expect(
      (
        await request(
          '/api/session',
          { headers: { cookie: `${COOKIE_NAME}=${'a'.repeat(64)}` } },
          false,
        )
      ).status,
    ).toBe(401);
  });

  it('redirects unauthenticated HTML app bookmarks to public login without redirecting APIs', async () => {
    for (const path of ['/app', '/app/board']) {
      for (const token of ['', `${COOKIE_NAME}=${'a'.repeat(64)}`]) {
        const response = await request(
          path,
          { headers: { accept: 'text/html', cookie: token } },
          false,
        );

        expect(response.status).toBe(303);

        expect(response.headers.get('location')).toBe('/');

        expect(response.headers.get('cache-control')).toBe('no-store');

        expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");

        expect(await response.text()).toBe('');
      }
    }

    const api = await request('/api/session', { headers: { accept: 'text/html' } }, false);

    expect(api.status).toBe(401);

    expect(api.headers.has('location')).toBe(false);

    expect(
      (await request('/app', { headers: { accept: 'text/html' }, method: 'POST' }, false)).status,
    ).toBe(401);

    expect((await request('/', { headers: { accept: 'text/html' } }, false)).status).toBe(200);
  });

  it('bounds bodies, requires same-origin JSON, and denies unexpected methods', async () => {
    expect((await request('/api/setup', { method: 'DELETE' }, false)).status).toBe(405);

    expect((await request('/api/setup', { method: 'POST' }, false)).status).toBe(415);

    expect(
      (
        await request(
          '/api/setup',
          { headers: { 'content-type': 'application/json' }, method: 'POST' },
          false,
        )
      ).status,
    ).toBe(400);

    for (const raw of ['{', '[]', 'null']) {
      expect(
        (
          await request(
            '/api/setup',
            { body: raw, headers: { 'content-type': 'application/json' }, method: 'POST' },
            false,
          )
        ).status,
      ).toBe(400);
    }

    const originHeaders: Record<string, string>[] = [
      { origin: 'https://evil.example' },
      { origin, 'sec-fetch-site': 'cross-site' },
      {},
    ];

    for (const headers of originHeaders) {
      const response = await worker.fetch(
        new Request(`${origin}/api/setup`, {
          ...payload({ password: 'long-password123', token: invitation }),
          headers,
          method: 'POST',
        }),
        { ASSETS: assets, DB: db },
      );

      expect(response.status).toBe(403);
    }

    expect(
      (
        await request(
          '/api/setup',
          {
            body: 'x',
            headers: { 'content-length': '70001', 'content-type': 'application/json' },
            method: 'POST',
          },
          false,
        )
      ).status,
    ).toBe(413);

    expect(
      (
        await request(
          '/api/setup',
          {
            body: 'x'.repeat(70001),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
          },
          false,
        )
      ).status,
    ).toBe(413);
  });

  it('rejects invalid and expired invitations or invalid passwords', async () => {
    for (const token of ['', 'unknown', 'a'.repeat(64), await issue('expired', false, start)]) {
      expect(
        (
          await request(
            '/api/setup',
            { method: 'POST', ...payload({ password: 'long-password123', token }) },
            false,
          )
        ).status,
      ).toBe(400);
    }

    for (const password of ['', 1, 'x'.repeat(129)]) {
      expect(
        (
          await request(
            '/api/setup',
            { method: 'POST', ...payload({ password, token: invitation }) },
            false,
          )
        ).status,
      ).toBe(400);
    }
  });

  it('consumes an invitation once, stores a salted hash, and starts a secure session', async () => {
    vi.spyOn(Date, 'now').mockReturnValue((start + 1000) * 1000);

    const response = await request(
      '/api/setup',
      { method: 'POST', ...payload({ password: 'long-password123', token: invitation }) },
      false,
    );

    expect(response.status).toBe(200);

    const value = (await response.json()) as {
      board: unknown;
      csrf: string;
      revision: number;
      username: string;
    };

    expect(value.board).toEqual(defaultBoard());

    expect(typeof value.csrf).toBe('string');

    expect(value.revision).toBe(0);

    expect(value.username).toBe('caregiver');

    csrf = value.csrf;

    cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';

    expect(response.headers.get('set-cookie')).toContain(
      'HttpOnly; SameSite=Strict; Secure; Max-Age=2592000',
    );

    expect(cookie).toMatch(new RegExp(`^${COOKIE_NAME}=[a-f0-9]{64}$`));

    const account = await db
      .prepare('SELECT password_hash FROM accounts WHERE username = ?')
      .bind('caregiver')
      .first<{ password_hash: string }>();

    expect(account?.password_hash).toMatch(/^pbkdf2-sha256\$600000\$[a-f0-9]{64}\$[a-f0-9]{64}$/);

    expect(account?.password_hash).not.toContain('long-password123');

    const tokenRow = await db
      .prepare('SELECT token_hash FROM sessions')
      .first<{ token_hash: string }>();

    expect(tokenRow?.token_hash).not.toBe(cookie.split('=')[1]);

    expect(
      (
        await request(
          '/api/setup',
          { method: 'POST', ...payload({ password: 'long-password123', token: invitation }) },
          false,
        )
      ).status,
    ).toBe(400);
  }, 30_000);

  it('authenticates, gates assets, and never silently reorders persisted boards', async () => {
    expect((await request('/app')).status).toBe(200);

    const response = await request('/api/session');

    expect(response.status).toBe(200);

    expect(await response.json()).toEqual({
      board: defaultBoard(),
      csrf,
      revision: 0,
      username: 'caregiver',
    });

    expect((await request('/api/unknown')).status).toBe(404);

    expect((await request('/api/session', { method: 'PUT', ...payload({}) })).status).toBe(404);
  });

  it('requires CSRF and validates board and revision, preserving optimistic concurrency', async () => {
    expect((await request('/api/logout', { method: 'POST' })).status).toBe(403);

    expect(
      (
        await request('/api/board', {
          method: 'PUT',
          ...payload({}),
          headers: { 'content-type': 'application/json' },
        })
      ).status,
    ).toBe(403);

    for (const board of [
      null,
      {},
      { ...defaultBoard(), slots: ['missing', 'missing', 'missing', 'missing'] },
      {
        ...defaultBoard(),
        phrases: Array.from({ length: 257 }, (_, i) => ({ id: `id-${i}`, text: 'Teste' })),
      },
      {
        ...defaultBoard(),
        phrases: [{ id: 'x'.repeat(129), text: 'Teste' }],
        slots: Array(4).fill('x'.repeat(129)),
      },
      'x'.repeat(64001),
    ]) {
      expect(
        (await request('/api/board', { method: 'PUT', ...payload({ board, revision: 0 }) })).status,
      ).toBe(400);
    }

    for (const revision of [-1, 0.2, '0', Number.MAX_SAFE_INTEGER]) {
      expect(
        (
          await request('/api/board', {
            method: 'PUT',
            ...payload({ board: defaultBoard(), revision }),
          })
        ).status,
      ).toBe(400);
    }

    const board = defaultBoard();

    board.phrases.reverse();

    const saves = await Promise.all(
      Array.from({ length: 2 }, () =>
        request('/api/board', { method: 'PUT', ...payload({ board, revision: 0 }) }),
      ),
    );

    expect(saves.map((response) => response.status).sort()).toEqual([200, 409]);

    expect(await saves.find((response) => response.status === 200)?.json()).toEqual({
      board,
      revision: 1,
    });

    expect(await (await request('/api/session')).json()).toEqual({
      board,
      csrf,
      revision: 1,
      username: 'caregiver',
    });
  });

  it('rotates at 24 hours with concurrent requests and preserves absolute expiry', async () => {
    const old = cookie;

    vi.spyOn(Date, 'now').mockReturnValue((start + 1000 + RENEW_SECONDS) * 1000);

    const responses = await Promise.all([request('/api/session'), request('/api/session')]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);

    const cookies = responses.map((response) => response.headers.get('set-cookie')?.split(';')[0]);

    expect(cookies[0]).toBe(cookies[1]);

    expect(cookies[0]).not.toBe(old);

    cookie = cookies[0] ?? '';

    const grace = await request('/api/session', { headers: { cookie: old } }, false);

    expect(grace.headers.get('set-cookie')?.split(';')[0]).toBe(cookie);

    vi.spyOn(Date, 'now').mockReturnValue((start + 1000 + RENEW_SECONDS + 61) * 1000);

    expect((await request('/api/session', { headers: { cookie: old } }, false)).status).toBe(401);

    const row = await db.prepare('SELECT expires_at FROM sessions').first<{ expires_at: number }>();

    expect(row?.expires_at).toBe(start + 1000 + SESSION_SECONDS);
  });

  it('logout revokes the session, including token grace', async () => {
    const response = await request('/api/logout', {
      headers: { 'x-csrf-token': csrf },
      method: 'POST',
    });

    expect(response.status).toBe(204);

    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');

    expect((await request('/api/session')).status).toBe(401);

    expect((await request('/app', { headers: { accept: 'text/html' } })).status).toBe(303);
  });

  it('login has indistinguishable credential failures and database-backed rate limiting', async () => {
    vi.spyOn(Date, 'now').mockReturnValue((start + 200_000) * 1000);

    const errors = [];

    for (const username of ['missing', 'caregiver']) {
      const response = await request(
        '/api/login',
        { method: 'POST', ...payload({ password: 'wrong-password123', username }) },
        false,
      );

      expect(response.status).toBe(401);

      errors.push(await response.json());
    }

    expect(errors[0]).toEqual(errors[1]);

    for (const input of [
      { password: 'long-password123', username: '!' },
      { password: 'short', username: 'caregiver' },
    ]) {
      expect(
        (await request('/api/login', { method: 'POST', ...payload(input) }, false)).status,
      ).toBe(401);
    }

    const response = await request(
      '/api/login',
      { method: 'POST', ...payload({ password: 'long-password123', username: 'CAREGIVER' }) },
      false,
    );

    expect(response.status).toBe(200);

    cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';

    const value = (await response.json()) as { csrf: string };

    csrf = value.csrf;

    await db
      .prepare(
        'INSERT INTO login_limits (key, attempts, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET attempts = excluded.attempts, expires_at = excluded.expires_at',
      )
      .bind(await digest('ip:local'), 10, start + 201_000)
      .run();

    expect(
      (
        await request(
          '/api/login',
          { method: 'POST', ...payload({ password: 'long-password123', username: 'caregiver' }) },
          false,
        )
      ).status,
    ).toBe(429);
  }, 30_000);

  it('reset is one use under concurrency and revokes every earlier session without losing the board', async () => {
    const old = cookie;

    vi.spyOn(Date, 'now').mockReturnValue((start + 300_000) * 1000);

    const token = await issue('caregiver', true, start + 301_000);
    const responses = await Promise.all([
      request(
        '/api/setup',
        { method: 'POST', ...payload({ password: 'replacement-password123', token }) },
        false,
      ),
      request(
        '/api/setup',
        { method: 'POST', ...payload({ password: 'other-password123', token }) },
        false,
      ),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);

    expect((await request('/api/session', { headers: { cookie: old } }, false)).status).toBe(401);

    const success = responses.find((response) => response.status === 200);

    cookie = success?.headers.get('set-cookie')?.split(';')[0] ?? '';

    const value = (await success?.json()) as { revision: number } | undefined;

    expect(value?.revision).toBe(1);

    vi.spyOn(Date, 'now').mockReturnValue((start + 300_000 + SESSION_SECONDS) * 1000);

    expect((await request('/api/session')).status).toBe(401);

    expect((await request('/app/board', { headers: { accept: 'text/html' } })).status).toBe(303);
  }, 30_000);

  it('permits explicit loopback HTTP cookies only, and returns safe infrastructure errors', async () => {
    vi.spyOn(Date, 'now').mockReturnValue((start + 400_000) * 1000);

    const token = await issue('localuser', false, start + 401_000);
    const local = await worker.fetch(
      new Request('http://localhost/api/setup', {
        body: JSON.stringify({ password: 'local-password123', token }),
        headers: { 'content-type': 'application/json', origin: 'http://localhost' },
        method: 'POST',
      }),
      { ASSETS: assets, DB: db },
    );

    expect(local.status).toBe(200);

    expect(local.headers.get('set-cookie')).toMatch(/^reader-local=/);

    expect(local.headers.get('set-cookie')).not.toContain('Secure');

    const localCookie = local.headers.get('set-cookie')?.split(';')[0] ?? '';

    expect(
      (
        await worker.fetch(
          new Request('http://localhost/api/session', { headers: { cookie: localCookie } }),
          { ASSETS: assets, DB: db },
        )
      ).status,
    ).toBe(200);

    const broken: Database = {
      batch: () => Promise.reject(new Error('private infrastructure details')),
      prepare: () => {
        throw new Error('private database details');
      },
    };
    const response = await worker.fetch(
      new Request(`${origin}/api/session`, {
        headers: { cookie: localCookie.replace('reader-local', COOKIE_NAME) },
      }),
      { ASSETS: assets, DB: broken },
    );

    expect(response.status).toBe(503);

    expect(await response.text()).not.toContain('private');
  }, 30_000);
});
