import type { Board } from './store';
import { defaultBoard, parseBoard } from './store';

export interface DatabaseResult<T = unknown> {
  meta: { changes: number };
  results: T[];
  success: boolean;
}

export interface DatabaseStatement {
  bind(...values: (number | string | null)[]): DatabaseStatement;

  first<T>(): Promise<T | null>;

  run(): Promise<DatabaseResult>;
}

export interface Database {
  batch<T = unknown>(statements: DatabaseStatement[]): Promise<DatabaseResult<T>[]>;

  prepare(sql: string): DatabaseStatement;
}

export interface Account {
  auth_version: number;
  board: string;
  id: string;
  password_hash: string | null;
  revision: number;
  username: string;
}

export interface Session extends Account {
  csrf: string;
  expires_at: number;
  previous_hash: string | null;
  previous_until: number;
  renewed_at: number;
  rotation_key: string;
  session_id: string;
  token_hash: string;
}

export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export const RENEW_SECONDS = 24 * 60 * 60;
export const PASSWORD_ITERATIONS = 600_000;

const encoder = new TextEncoder();

export class AccountError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);

    this.status = status;
  }
}

export function randomToken(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function digest(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

export function validToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function username(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}$/.test(value)) {
    throw new AccountError('Não foi possível iniciar sessão. Verifique os dados.', 401);
  }

  return value.toLowerCase();
}

export function password(value: unknown): string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) {
    throw new AccountError('A palavra-passe deve ter entre 12 e 128 caracteres.', 400);
  }

  return value;
}

async function derive(value: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(value), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      hash: 'SHA-256',
      iterations: PASSWORD_ITERATIONS,
      name: 'PBKDF2',
      salt: encoder.encode(salt),
    },
    key,
    256,
  );

  return hex(new Uint8Array(bits));
}

export async function hashPassword(value: string): Promise<string> {
  const salt = randomToken();

  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${salt}$${await derive(value, salt)}`;
}

export async function verifyPassword(value: string, stored: string | null): Promise<boolean> {
  const parts = stored?.split('$');
  const valid =
    parts?.length === 4 &&
    parts[0] === 'pbkdf2-sha256' &&
    parts[1] === String(PASSWORD_ITERATIONS) &&
    validToken(parts[2]) &&
    validToken(parts[3]);
  const salt = valid && parts ? parts[2] : '0'.repeat(64);
  const expected = valid && parts ? parts[3] : '0'.repeat(64);
  const actual = await derive(value, salt);
  let difference = 0;

  for (let index = 0; index < actual.length; index++) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }

  return valid && difference === 0;
}

export function sessionShape(
  account: Account,
  csrf: string,
): {
  board: Board;
  csrf: string;
  revision: number;
  username: string;
} {
  return {
    board: parseBoard(account.board),
    csrf,
    revision: account.revision,
    username: account.username,
  };
}

export async function rateLimit(db: Database, key: string, now: number): Promise<void> {
  const row = await db
    .prepare(
      `INSERT INTO login_limits (key, attempts, expires_at) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
       attempts = CASE WHEN expires_at <= ? THEN 1 ELSE attempts + 1 END,
       expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
       RETURNING attempts`,
    )
    .bind(key, now + 900, now, now)
    .first<{ attempts: number }>();

  if (!row || row.attempts > 10) {
    throw new AccountError('Demasiadas tentativas. Aguarde 15 minutos.', 429);
  }
}

const sessionSelect = `SELECT a.*, s.csrf, s.expires_at, s.id AS session_id,
  s.token_hash, s.previous_hash, s.previous_until, s.renewed_at, s.rotation_key
  FROM sessions s JOIN accounts a ON a.id = s.account_id
  WHERE s.auth_version = a.auth_version AND s.expires_at > ?
  AND (s.token_hash = ? OR (s.previous_hash = ? AND s.previous_until > ?))`;

export async function authenticate(
  db: Database,
  token: string,
  now: number,
): Promise<{ session: Session; token: string }> {
  if (!validToken(token)) {
    throw new AccountError('Inicie sessão para continuar.', 401);
  }

  const hash = await digest(token);
  const session = await db.prepare(sessionSelect).bind(now, hash, hash, now).first<Session>();

  if (!session) {
    throw new AccountError('A sessão terminou. Inicie sessão novamente.', 401);
  }

  if (session.token_hash !== hash || session.renewed_at <= now - RENEW_SECONDS) {
    const next = await digest(`${token}:${session.rotation_key}`);
    const nextHash = await digest(next);

    if (session.token_hash === hash) {
      await db
        .prepare(
          `UPDATE sessions SET token_hash = ?, previous_hash = ?, previous_until = ?, renewed_at = ?
           WHERE id = ? AND token_hash = ? AND renewed_at <= ? AND expires_at > ?`,
        )
        .bind(nextHash, hash, now + 60, now, session.session_id, hash, now - RENEW_SECONDS, now)
        .run();
    }

    const current = await db
      .prepare(sessionSelect)
      .bind(now, nextHash, nextHash, now)
      .first<Session>();

    if (!current) {
      throw new AccountError('A sessão terminou. Inicie sessão novamente.', 401);
    }

    return { session: current, token: next };
  }

  return { session, token };
}

function insertSession(
  db: Database,
  accountId: string,
  passwordHash: string,
  tokenHash: string,
  csrf: string,
  now: number,
): DatabaseStatement {
  return db
    .prepare(
      `INSERT INTO sessions (id, account_id, auth_version, token_hash, csrf, rotation_key,
       expires_at, renewed_at)
       SELECT ?, id, auth_version, ?, ?, ?, ?, ? FROM accounts
       WHERE id = ? AND password_hash = ?`,
    )
    .bind(
      randomToken(),
      tokenHash,
      csrf,
      randomToken(),
      now + SESSION_SECONDS,
      now,
      accountId,
      passwordHash,
    );
}

export async function login(
  db: Database,
  name: string,
  secret: string,
  now: number,
): Promise<{ session: Session; token: string }> {
  const account = await db
    .prepare('SELECT * FROM accounts WHERE username = ?')
    .bind(name)
    .first<Account>();
  const valid = await verifyPassword(secret, account?.password_hash ?? null);

  if (!valid || !account?.password_hash) {
    throw new AccountError('Não foi possível iniciar sessão. Verifique os dados.', 401);
  }

  const token = randomToken();
  const result = await insertSession(
    db,
    account.id,
    account.password_hash,
    await digest(token),
    randomToken(),
    now,
  ).run();

  if (result.meta.changes !== 1) {
    throw new AccountError('Não foi possível iniciar sessão. Tente novamente.', 401);
  }

  return authenticate(db, token, now);
}

export async function setup(
  db: Database,
  token: string,
  secret: string,
  now: number,
): Promise<{ session: Session; token: string }> {
  if (!validToken(token)) {
    throw new AccountError('A ligação é inválida ou já expirou.', 400);
  }

  const tokenHash = await digest(token);
  const invitation = await db
    .prepare('SELECT account_id FROM account_tokens WHERE token_hash = ? AND expires_at > ?')
    .bind(tokenHash, now)
    .first<{ account_id: string }>();

  if (!invitation) {
    throw new AccountError('A ligação é inválida ou já expirou.', 400);
  }

  const hash = await hashPassword(secret);
  const sessionToken = randomToken();
  const result = await db.batch([
    db
      .prepare(
        `UPDATE accounts SET password_hash = ?, auth_version = auth_version + 1
       WHERE id = ? AND EXISTS (SELECT 1 FROM account_tokens WHERE token_hash = ?
       AND account_id = accounts.id AND expires_at > ?)`,
      )
      .bind(hash, invitation.account_id, tokenHash, now),
    db
      .prepare(
        'DELETE FROM sessions WHERE account_id = ? AND EXISTS (SELECT 1 FROM accounts WHERE id = ? AND password_hash = ?)',
      )
      .bind(invitation.account_id, invitation.account_id, hash),
    insertSession(db, invitation.account_id, hash, await digest(sessionToken), randomToken(), now),
    db
      .prepare(
        'DELETE FROM account_tokens WHERE account_id = ? AND EXISTS (SELECT 1 FROM accounts WHERE id = ? AND password_hash = ?)',
      )
      .bind(invitation.account_id, invitation.account_id, hash),
  ]);

  if (result[0]?.meta.changes !== 1) {
    throw new AccountError('A ligação é inválida ou já expirou.', 400);
  }

  return authenticate(db, sessionToken, now);
}

export function validateBoard(value: unknown): Board {
  const raw = JSON.stringify(value);

  if (!raw || raw.length > 64_000) {
    throw new AccountError('O quadro é demasiado grande.', 400);
  }

  try {
    const board = parseBoard(raw);

    if (board.phrases.length > 256 || board.phrases.some((phrase) => phrase.id.length > 128)) {
      throw new Error('Board limits exceeded.');
    }

    return board;
  } catch {
    throw new AccountError('O quadro contém frases inválidas.', 400);
  }
}

export function initialBoard(): string {
  return JSON.stringify(defaultBoard());
}
