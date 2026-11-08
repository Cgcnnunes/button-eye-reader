import { type Board, parseBoard } from './store';

export interface AccountSession {
  board: Board;
  csrf: string;
  revision: number;
  username: string;
}

interface SavedBoard {
  board: Board;
  revision: number;
}

function savedBoard(value: unknown): SavedBoard {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('board' in value) ||
    !('revision' in value) ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0
  )
    throw new Error('A resposta das preferências não é válida.');

  return { board: parseBoard(JSON.stringify(value.board)), revision: value.revision };
}

function session(value: unknown): AccountSession {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('username' in value) ||
    typeof value.username !== 'string' ||
    !('csrf' in value) ||
    typeof value.csrf !== 'string' ||
    !value.csrf
  )
    throw new Error('A resposta da sessão não é válida.');

  return { ...savedBoard(value), csrf: value.csrf, username: value.username };
}

async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  csrf?: string,
): Promise<Response> {
  const response = await fetch(path, {
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
    },
    method,
  });

  if (!response.ok && !(path === '/api/session' && response.status === 401)) {
    const value: unknown = await response.json();

    throw new Error(
      typeof value === 'object' &&
        value !== null &&
        'error' in value &&
        typeof value.error === 'string'
        ? value.error
        : `O pedido falhou (${response.status}).`,
    );
  }

  return response;
}

export async function getSession(): Promise<AccountSession | null> {
  const response = await request('/api/session');

  return response.status === 401 ? null : session(await response.json());
}

export async function login(username: string, password: string): Promise<AccountSession> {
  return session(await (await request('/api/login', 'POST', { password, username })).json());
}

export async function setup(token: string, password: string): Promise<AccountSession> {
  return session(await (await request('/api/setup', 'POST', { password, token })).json());
}

export async function logout(csrf: string): Promise<void> {
  await request('/api/logout', 'POST', undefined, csrf);
}

export async function saveBoard(board: Board, revision: number, csrf: string): Promise<SavedBoard> {
  return savedBoard(await (await request('/api/board', 'PUT', { board, revision }, csrf)).json());
}
