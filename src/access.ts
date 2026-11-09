import type { JWTPayload } from 'jose';
import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import type { Board } from './store.ts';
import { defaultBoard, parseBoard } from './store.ts';

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
  prepare(sql: string): DatabaseStatement;
}

export interface AccessConfiguration {
  ACCESS_AUD?: string;
  ACCESS_TEAM_DOMAIN?: string;
}

export interface Identity {
  email: string;
  subject: string;
}

export interface Preferences {
  board: string;
  revision: number;
}

export class AccessError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);

    this.status = status;
  }
}

export class InfrastructureError extends Error {
  readonly category: string;

  constructor(category: string) {
    super('Access infrastructure unavailable.');

    this.category = category;
  }
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export function validAccessConfiguration(
  configuration: AccessConfiguration,
): configuration is Required<AccessConfiguration> {
  const { ACCESS_AUD: audience, ACCESS_TEAM_DOMAIN: domain } = configuration;

  return (
    typeof domain === 'string' &&
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(domain) &&
    typeof audience === 'string' &&
    /^[a-f0-9]{64}$/.test(audience)
  );
}

export async function authenticate(
  request: Request,
  configuration: AccessConfiguration,
): Promise<Identity> {
  if (!validAccessConfiguration(configuration)) {
    throw new AccessError('O acesso ainda não está configurado.', 503);
  }

  const { ACCESS_AUD: audience, ACCESS_TEAM_DOMAIN: domain } = configuration;
  const token = request.headers.get('cf-access-jwt-assertion');

  if (!token) {
    throw new AccessError('Inicie sessão para continuar.', 401);
  }

  const issuer = `https://${domain}`;
  let keys = keySets.get(issuer);

  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));

    keySets.set(issuer, keys);
  }

  let payload: JWTPayload;

  try {
    ({ payload } = await jwtVerify(token, keys, {
      algorithms: ['RS256'],
      audience,
      issuer,
      requiredClaims: ['exp', 'iat', 'sub'],
    }));
  } catch (error) {
    if (
      error instanceof errors.JWTExpired ||
      error instanceof errors.JWTInvalid ||
      error instanceof errors.JWTClaimValidationFailed ||
      error instanceof errors.JWSInvalid ||
      error instanceof errors.JWSSignatureVerificationFailed ||
      error instanceof errors.JOSEAlgNotAllowed ||
      error instanceof errors.JWKSNoMatchingKey
    ) {
      throw new AccessError('A sessão terminou. Inicie sessão novamente.', 401);
    }

    throw new InfrastructureError('access-key-service');
  }

  if (
    typeof payload.sub !== 'string' ||
    !payload.sub.trim() ||
    payload.sub.length > 256 ||
    typeof payload.email !== 'string' ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) ||
    payload.email.length > 254 ||
    typeof payload.iat !== 'number' ||
    !Number.isSafeInteger(payload.iat) ||
    payload.iat > Math.floor(Date.now() / 1000) ||
    typeof payload.exp !== 'number' ||
    !Number.isSafeInteger(payload.exp) ||
    payload.exp <= payload.iat ||
    'common_name' in payload ||
    'service_token_id' in payload ||
    'service_token_status' in payload ||
    'service_token' in payload ||
    payload.type === 'service'
  ) {
    throw new AccessError('Inicie sessão com o seu email para continuar.', 401);
  }

  return { email: payload.email, subject: payload.sub };
}

export async function csrfToken(
  identity: Identity,
  configuration: AccessConfiguration,
): Promise<string> {
  const value = JSON.stringify([
    'reader-csrf-v1',
    configuration.ACCESS_TEAM_DOMAIN,
    configuration.ACCESS_AUD,
    identity.subject,
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function preferences(db: Database, identity: Identity): Promise<Preferences> {
  await db
    .prepare(
      'INSERT INTO user_preferences (access_subject, board) VALUES (?, ?) ON CONFLICT(access_subject) DO NOTHING',
    )
    .bind(identity.subject, JSON.stringify(defaultBoard()))
    .run();

  const result = await db
    .prepare('SELECT board, revision FROM user_preferences WHERE access_subject = ?')
    .bind(identity.subject)
    .first<Preferences>();

  if (!result) {
    throw new InfrastructureError('database-operation');
  }

  return result;
}

export function validateBoard(value: unknown): Board {
  const raw = JSON.stringify(value);

  if (!raw || raw.length > 64_000) {
    throw new AccessError('O quadro é demasiado grande.', 400);
  }

  try {
    const board = parseBoard(raw);

    if (board.phrases.length > 256 || board.phrases.some((phrase) => phrase.id.length > 128)) {
      throw new Error('Board limits exceeded.');
    }

    return board;
  } catch {
    throw new AccessError('O quadro contém frases inválidas.', 400);
  }
}
