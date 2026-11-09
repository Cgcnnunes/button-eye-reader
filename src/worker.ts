import type { Database, Session } from './accounts';
import {
  AccountError,
  authenticate,
  digest,
  login,
  password,
  rateLimit,
  sessionShape,
  setup,
  username,
  validateBoard,
} from './accounts';

export interface Environment {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB?: Database;
}

const COOKIE_NAME = '__Host-reader';

const LOCAL_COOKIE_NAME = 'reader-local';

function local(url: URL): boolean {
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

function tokenFrom(request: Request, url: URL): string {
  const name = local(url) ? LOCAL_COOKIE_NAME : COOKIE_NAME;

  return (
    request.headers
      .get('cookie')
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? ''
  );
}

function cookie(url: URL, token: string, expires: number, now: number): string {
  const secure = local(url) ? '' : '; Secure';
  const name = local(url) ? LOCAL_COOKIE_NAME : COOKIE_NAME;

  return `${name}=${token}; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=${Math.max(0, expires - now)}`;
}

function protect(response: Response): Response {
  const headers = new Headers(response.headers);

  headers.set('Cache-Control', 'no-store');

  headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );

  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  headers.set('Referrer-Policy', 'no-referrer');

  headers.set('X-Content-Type-Options', 'nosniff');

  headers.set('X-Frame-Options', 'DENY');

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function mutation(request: Request, url: URL): void {
  if (
    request.headers.get('origin') !== url.origin ||
    (request.headers.has('sec-fetch-site') &&
      request.headers.get('sec-fetch-site') !== 'same-origin')
  ) {
    throw new AccountError('O pedido não foi autorizado.', 403);
  }
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    throw new AccountError('O pedido deve usar JSON.', 415);
  }

  if (Number(request.headers.get('content-length')) > 70_000) {
    throw new AccountError('O pedido é demasiado grande.', 413);
  }

  const reader = request.body?.getReader();

  if (!reader) {
    throw new AccountError('O pedido não contém dados válidos.', 400);
  }

  let size = 0;
  let raw = '';
  const decoder = new TextDecoder();

  while (true) {
    const chunk = await reader.read();

    if (chunk.done) {
      break;
    }

    size += chunk.value.byteLength;

    if (size > 70_000) {
      await reader.cancel();

      throw new AccountError('O pedido é demasiado grande.', 413);
    }

    raw += decoder.decode(chunk.value, { stream: true });
  }

  raw += decoder.decode();

  try {
    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Expected object.');
    }

    return parsed as Record<string, unknown>;
  } catch {
    throw new AccountError('O pedido não contém dados válidos.', 400);
  }
}

function csrf(request: Request, session: Session): void {
  if (request.headers.get('x-csrf-token') !== session.csrf) {
    throw new AccountError('O pedido não foi autorizado. Atualize a página.', 403);
  }
}

async function route(request: Request, environment: Environment): Promise<Response> {
  const url = new URL(request.url);
  const api = url.pathname === '/api' || url.pathname.startsWith('/api/');
  const app = url.pathname === '/app' || url.pathname.startsWith('/app/');
  const now = Math.floor(Date.now() / 1000);

  if (!api && !app) {
    return environment.ASSETS.fetch(request);
  }

  if (!environment.DB) {
    throw new AccountError('O serviço de contas ainda não está disponível.', 503);
  }

  if (url.protocol !== 'https:' && !local(url)) {
    throw new AccountError('É necessária uma ligação HTTPS segura.', 403);
  }

  const db = environment.DB;

  if (api && !['GET', 'POST', 'PUT'].includes(request.method)) {
    throw new AccountError('Este método não é permitido.', 405);
  }

  if (api && request.method !== 'GET') {
    mutation(request, url);
  }

  if (request.method === 'POST' && ['/api/login', '/api/setup'].includes(url.pathname)) {
    const input = await body(request);
    const ip = request.headers.get('cf-connecting-ip') ?? 'local';

    await rateLimit(db, await digest(`ip:${ip}`), now);

    let result: { session: Session; token: string };

    if (url.pathname === '/api/login') {
      const name = username(input.username);

      await rateLimit(db, await digest(`username:${name}`), now);

      let secret: string;

      try {
        secret = password(input.password);
      } catch {
        throw new AccountError('Não foi possível iniciar sessão. Verifique os dados.', 401);
      }

      result = await login(db, name, secret, now);
    } else {
      result = await setup(
        db,
        typeof input.token === 'string' ? input.token : '',
        password(input.password),
        now,
      );
    }

    const response = json(sessionShape(result.session, result.session.csrf));

    response.headers.set('Set-Cookie', cookie(url, result.token, result.session.expires_at, now));

    return response;
  }

  const authenticated = await authenticate(db, tokenFrom(request, url), now);
  const { session, token } = authenticated;
  let response: Response;

  if (app) {
    response = await environment.ASSETS.fetch(request);
  } else if (url.pathname === '/api/session' && request.method === 'GET') {
    response = json(sessionShape(session, session.csrf));
  } else if (url.pathname === '/api/logout' && request.method === 'POST') {
    csrf(request, session);

    await db.prepare('DELETE FROM sessions WHERE id = ?').bind(session.session_id).run();

    response = new Response(null, { status: 204 });

    response.headers.set('Set-Cookie', cookie(url, '', now, now));

    return response;
  } else if (url.pathname === '/api/board' && request.method === 'PUT') {
    csrf(request, session);

    const input = await body(request);
    const board = validateBoard(input.board);

    if (
      typeof input.revision !== 'number' ||
      !Number.isSafeInteger(input.revision) ||
      input.revision < 0 ||
      input.revision >= Number.MAX_SAFE_INTEGER
    ) {
      throw new AccountError('A revisão do quadro é inválida.', 400);
    }

    const result = await db
      .prepare(
        `UPDATE accounts SET board = ?, revision = revision + 1 WHERE id = ? AND revision = ?
       AND EXISTS (SELECT 1 FROM sessions WHERE id = ? AND account_id = accounts.id
       AND auth_version = accounts.auth_version AND expires_at > ?)`,
      )
      .bind(JSON.stringify(board), session.id, input.revision, session.session_id, now)
      .run();

    if (result.meta.changes !== 1) {
      throw new AccountError(
        'O quadro foi alterado noutra sessão. Atualize a página antes de guardar.',
        409,
      );
    }

    response = json({ board, revision: input.revision + 1 });
  } else {
    throw new AccountError('Este pedido não existe.', 404);
  }

  const headers = new Headers(response.headers);

  headers.set('Set-Cookie', cookie(url, token, session.expires_at, now));

  return new Response(response.body, { headers, status: response.status });
}

function reportFailure(error: unknown, pathname: string): void {
  const message = error instanceof Error ? error.message : '';
  const name = error instanceof Error ? error.name : '';
  const errorType = [
    'Error',
    'OperationError',
    'NotSupportedError',
    'TypeError',
    'RangeError',
    'InvalidAccessError',
  ].includes(name)
    ? name
    : 'UnknownError';
  const category =
    /PBKDF2/i.test(message) && /iteration|limit|100.?000/i.test(message)
      ? 'password-kdf-limit'
      : /D1_ERROR|D1_EXEC_ERROR|SQLITE_/i.test(message)
        ? 'database-operation'
        : /PBKDF2|deriveBits|crypto/i.test(message)
          ? 'cryptography-operation'
          : 'unexpected-operation';
  const operation = [
    '/api/setup',
    '/api/login',
    '/api/session',
    '/api/logout',
    '/api/board',
  ].includes(pathname)
    ? pathname
    : 'other';

  console.error('Account request failed', { category, errorType, operation });
}

async function serve(request: Request, environment: Environment): Promise<Response> {
  try {
    return protect(await route(request, environment));
  } catch (error) {
    const url = new URL(request.url);
    const app = url.pathname === '/app' || url.pathname.startsWith('/app/');

    if (!(error instanceof AccountError)) {
      reportFailure(error, url.pathname);
    }

    if (
      error instanceof AccountError &&
      error.status === 401 &&
      app &&
      request.method === 'GET' &&
      request.headers.get('accept')?.includes('text/html')
    ) {
      return protect(new Response(null, { headers: { Location: '/' }, status: 303 }));
    }

    return protect(
      json(
        {
          error:
            error instanceof AccountError
              ? error.message
              : 'Não foi possível concluir o pedido. Tente novamente.',
        },
        error instanceof AccountError ? error.status : 503,
      ),
    );
  }
}

export default { fetch: serve };
