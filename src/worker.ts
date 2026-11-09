import type { AccessConfiguration, Database } from './access';
import {
  AccessError,
  authenticate,
  csrfToken,
  InfrastructureError,
  preferences,
  validateBoard,
} from './access';
import { parseBoard } from './store';

export interface Environment extends AccessConfiguration {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB?: Database;
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

function mutation(request: Request, url: URL): void {
  if (
    request.headers.get('origin') !== url.origin ||
    (request.headers.has('sec-fetch-site') &&
      request.headers.get('sec-fetch-site') !== 'same-origin')
  ) {
    throw new AccessError('O pedido não foi autorizado.', 403);
  }
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    throw new AccessError('O pedido deve usar JSON.', 415);
  }

  if (Number(request.headers.get('content-length')) > 70_000) {
    throw new AccessError('O pedido é demasiado grande.', 413);
  }

  const reader = request.body?.getReader();

  if (!reader) {
    throw new AccessError('O pedido não contém dados válidos.', 400);
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

      throw new AccessError('O pedido é demasiado grande.', 413);
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
    throw new AccessError('O pedido não contém dados válidos.', 400);
  }
}

async function route(request: Request, environment: Environment): Promise<Response> {
  const url = new URL(request.url);
  const api = url.pathname === '/api' || url.pathname.startsWith('/api/');

  // Access protects the entire host at the edge, including assets used by Service Auth smoke tests.
  if (!api) {
    return environment.ASSETS.fetch(request);
  }

  if (!environment.DB) {
    throw new AccessError('O serviço ainda não está disponível.', 503);
  }

  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  ) {
    throw new AccessError('É necessária uma ligação HTTPS segura.', 403);
  }

  const identity = await authenticate(request, environment);
  const csrf = await csrfToken(identity, environment);

  if (url.pathname === '/api/session') {
    if (request.method !== 'GET') {
      throw new AccessError('Este método não é permitido.', 405);
    }

    const saved = await preferences(environment.DB, identity);

    return Response.json({
      board: parseBoard(saved.board),
      csrf,
      revision: saved.revision,
      username: identity.email,
    });
  }

  if (url.pathname !== '/api/board') {
    throw new AccessError('Este pedido não existe.', 404);
  }

  if (request.method !== 'PUT') {
    throw new AccessError('Este método não é permitido.', 405);
  }

  mutation(request, url);

  if (request.headers.get('x-csrf-token') !== csrf) {
    throw new AccessError('O pedido não foi autorizado. Atualize a página.', 403);
  }

  const input = await body(request);
  const board = validateBoard(input.board);

  if (
    typeof input.revision !== 'number' ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 0 ||
    input.revision >= Number.MAX_SAFE_INTEGER
  ) {
    throw new AccessError('A revisão do quadro é inválida.', 400);
  }

  const result = await environment.DB.prepare(
    'UPDATE user_preferences SET board = ?, revision = revision + 1 WHERE access_subject = ? AND revision = ?',
  )
    .bind(JSON.stringify(board), identity.subject, input.revision)
    .run();

  if (result.meta.changes !== 1) {
    throw new AccessError(
      'O quadro foi alterado noutra sessão. Atualize a página antes de guardar.',
      409,
    );
  }

  return Response.json({ board, revision: input.revision + 1 });
}

function reportRequest(status: number, pathname: string, started: number, error?: unknown): void {
  const api = pathname === '/api' || pathname.startsWith('/api/');

  if (!api && status < 500) return;

  const name = error instanceof Error ? error.name : '';
  const errorType = ['Error', 'OperationError', 'TypeError', 'RangeError'].includes(name)
    ? name
    : 'other';
  const category =
    error instanceof InfrastructureError &&
    ['access-key-service', 'database-operation'].includes(error.category)
      ? error.category
      : error instanceof Error && /D1_ERROR|D1_EXEC_ERROR|SQLITE_/i.test(error.message)
        ? 'database-operation'
        : error !== undefined && !(error instanceof AccessError)
          ? 'unexpected-operation'
          : status >= 500
            ? 'service-unavailable'
            : status === 409
              ? 'save-conflict'
              : status >= 400
                ? 'request-rejected'
                : 'success';
  const operation = ['/api/session', '/api/board'].includes(pathname) ? pathname : 'other';
  const entry = {
    category,
    durationMs: Math.max(0, Math.round(performance.now() - started)),
    ...(error !== undefined && !(error instanceof AccessError) ? { errorType } : {}),
    message: 'Worker request',
    operation,
    status,
  };

  if (status >= 500) console.error(entry);
  else if (status >= 400) console.warn(entry);
  else console.info(entry);
}

async function serve(request: Request, environment: Environment): Promise<Response> {
  const started = performance.now();
  const pathname = new URL(request.url).pathname;
  let response: Response;
  let failure: unknown;

  try {
    response = protect(await route(request, environment));
  } catch (error) {
    failure = error;

    response = protect(
      Response.json(
        {
          error:
            error instanceof AccessError
              ? error.message
              : 'Não foi possível concluir o pedido. Tente novamente.',
        },
        { status: error instanceof AccessError ? error.status : 503 },
      ),
    );
  }

  reportRequest(response.status, pathname, started, failure);

  return response;
}

export default { fetch: serve };
