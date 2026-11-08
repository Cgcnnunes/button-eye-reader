import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { pbkdf2Sync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Database, DatabaseResult, DatabaseStatement, Session } from '../src/accounts';
import {
  AccountError,
  authenticate,
  hashPassword,
  login,
  rateLimit,
  setup,
  username,
  validateBoard,
  verifyPassword,
} from '../src/accounts';

function mockDatabase(rows: unknown[], changes = 0): Database {
  const first = vi
    .fn<() => Promise<unknown>>()
    .mockImplementation(() => Promise.resolve(rows.shift() ?? null));
  const statement: DatabaseStatement = {
    bind: () => statement,
    first: <T>() => first() as Promise<T | null>,
    run: () => Promise.resolve({ meta: { changes }, results: [], success: true }),
  };

  return {
    batch: <T>() =>
      Promise.resolve([{ meta: { changes }, results: [], success: true }] as DatabaseResult<T>[]),
    prepare: () => statement,
  };
}

describe('account cryptography and failure races', () => {
  it('matches an independent PBKDF2-SHA256 600000 vector and salts each password', async () => {
    const hash = await hashPassword('strong-password123');
    const [scheme, count, salt, result] = hash.split('$');

    expect(scheme).toBe('pbkdf2-sha256');

    expect(count).toBe('600000');

    expect(pbkdf2Sync('strong-password123', salt, 600000, 32, 'sha256').toString('hex')).toBe(
      result,
    );

    expect(await verifyPassword('strong-password123', hash)).toBe(true);

    expect(await verifyPassword('wrong-password123', hash)).toBe(false);

    expect(await hashPassword('strong-password123')).not.toBe(hash);

    for (const invalid of [
      null,
      '',
      'pbkdf2-sha256$1$bad$bad',
      `pbkdf2-sha256$600000$${'a'.repeat(64)}$bad`,
    ]) {
      expect(await verifyPassword('strong-password123', invalid)).toBe(false);
    }
  }, 30_000);

  it('actually supports 600000 iterations in installed workerd, without a weakened fallback', async () => {
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        compatibilityDate: '2026-11-07',
        modules: true,
        script: `export default {async fetch() {
        const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('strong-password123'), 'PBKDF2', false, ['deriveBits']);
        const result = await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', salt:new TextEncoder().encode('test-salt'), iterations:600000}, key, 256);
        return new Response(Array.from(new Uint8Array(result), b => b.toString(16).padStart(2,'0')).join(''));
      }}`,
      }),
    );

    try {
      expect(await (await runtime.dispatchFetch('https://reader.example')).text()).toBe(
        pbkdf2Sync('strong-password123', 'test-salt', 600000, 32, 'sha256').toString('hex'),
      );
    } finally {
      await runtime.dispose();
    }
  }, 30_000);

  it('rejects invalid usernames, limits, revisions and malformed accounts', async () => {
    expect(username('CareGiver')).toBe('caregiver');

    for (const value of [null, '', 'a', 'x'.repeat(65), 'name@email']) {
      expect(() => username(value)).toThrow(AccountError);
    }

    expect(() => validateBoard(undefined)).toThrow(AccountError);

    await expect(rateLimit(mockDatabase([null]), 'key', 1)).rejects.toThrow(AccountError);

    await expect(authenticate(mockDatabase([]), 'invalid', 1)).rejects.toThrow(AccountError);
  });

  it('fails closed when a reset races credential verification or token renewal', async () => {
    const password = await hashPassword('strong-password123');
    const account = {
      auth_version: 1,
      board: '{}',
      id: 'id',
      password_hash: password,
      revision: 0,
      username: 'caregiver',
    };

    await expect(
      login(mockDatabase([account]), 'caregiver', 'strong-password123', 100),
    ).rejects.toThrow(AccountError);

    const session: Session = {
      ...account,
      csrf: 'csrf',
      expires_at: 500000,
      previous_hash: null,
      previous_until: 0,
      renewed_at: 0,
      rotation_key: 'key',
      session_id: 'session',
      token_hash: 'different',
    };

    await expect(
      authenticate(mockDatabase([session, null]), 'a'.repeat(64), 100000),
    ).rejects.toThrow(AccountError);

    await expect(
      setup(mockDatabase([{ account_id: 'id' }]), 'a'.repeat(64), 'strong-password123', 100),
    ).rejects.toThrow(AccountError);
  }, 30_000);
});
