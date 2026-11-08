import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSession, login, logout, saveBoard, setup } from '../src/account-client';
import { defaultBoard } from '../src/store';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('account API client', () => {
  it('loads authenticated preferences and sends credentials, revisions and CSRF', async () => {
    const value = { board: defaultBoard(), csrf: 'csrf', revision: 1, username: 'helper' };
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json(value)));

    vi.stubGlobal('fetch', fetchMock);

    expect(await getSession()).toEqual(value);

    expect(await login('helper', 'long-password')).toEqual(value);

    expect(await setup('token', 'long-password')).toEqual(value);

    expect(await saveBoard(value.board, 1, value.csrf)).toEqual({
      board: value.board,
      revision: 1,
    });

    await logout(value.csrf);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/board',
      expect.objectContaining({
        body: JSON.stringify({ board: value.board, revision: 1 }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-csrf-token': 'csrf' },
        method: 'PUT',
      }),
    );
  });

  it('distinguishes anonymous sessions from unavailable services and failed mutations', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    expect(await getSession()).toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: 'Conflito' }, { status: 409 })),
    );

    await expect(saveBoard(defaultBoard(), 0, 'csrf')).rejects.toThrow('Conflito');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({}, { status: 503 })));

    await expect(login('helper', 'password')).rejects.toThrow('503');
  });

  it('rejects malformed session and board response shapes', async () => {
    for (const value of [null, {}, { username: 1 }, { csrf: '', username: 'helper' }]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(value)));

      await expect(getSession()).rejects.toThrow('sessão não é válida');
    }

    for (const value of [
      null,
      {},
      { board: defaultBoard(), revision: -1 },
      { board: defaultBoard(), revision: 0.5 },
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(value)));

      await expect(saveBoard(defaultBoard(), 0, 'csrf')).rejects.toThrow(
        'preferências não é válida',
      );
    }

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ board: {}, csrf: 'csrf', revision: 0, username: 'helper' }),
        ),
    );

    await expect(getSession()).rejects.toThrow();
  });

  it('surfaces network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));

    await expect(getSession()).rejects.toThrow('Offline');
  });
});
