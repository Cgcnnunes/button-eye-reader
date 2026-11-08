// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticCapture, REPORT_TRANSFER_KEY } from '../src/diagnostics';

const fetch = vi.fn<typeof globalThis.fetch>();
const id = '11111111-1111-4111-8111-111111111111';

function button(id: string): HTMLButtonElement {
  const found = document.getElementById(id);

  if (!(found instanceof HTMLButtonElement)) throw new Error('Missing test button.');

  return found;
}

function status(): string {
  return document.getElementById('report-status')?.textContent ?? '';
}

function pending(expires = Date.now() + 900000): void {
  sessionStorage.setItem(
    REPORT_TRANSFER_KEY,
    JSON.stringify({
      expires,
      report: new DiagnosticCapture('0.3.4', 1180, 820, 0).finish('failed', 1000),
    }),
  );
}

describe('caregiver diagnostic report page', () => {
  beforeEach(() => {
    vi.resetModules();

    fetch.mockReset();

    fetch.mockImplementation(() => Promise.resolve(Response.json({ cursor: null, reports: [] })));

    vi.stubGlobal('fetch', fetch);

    document.body.innerHTML = new DOMParser().parseFromString(
      readFileSync('diagnostics.html', 'utf8'),
      'text/html',
    ).body.innerHTML;

    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not fetch or upload anything automatically and permits discard', async () => {
    pending();

    await import('../src/diagnostics-page');

    expect(fetch).not.toHaveBeenCalled();

    expect(button('send-report').disabled).toBe(false);

    expect(document.getElementById('pending-report')?.textContent).toContain('"outcome": "failed"');

    button('discard-report').click();

    expect(sessionStorage.getItem(REPORT_TRANSFER_KEY)).toBeNull();

    expect(button('send-report').disabled).toBe(true);

    expect(status()).toContain('descartado');
  });

  it('requires explicit upload confirmation and clears the pending report on success', async () => {
    pending();

    await import('../src/diagnostics-page');

    fetch.mockResolvedValueOnce(
      Response.json({ expires: Date.now() + 604800000, id }, { status: 201 }),
    );

    button('send-report').click();

    await vi.waitFor(() => {
      expect(status()).toContain('Relatório enviado');
    });

    expect(fetch).toHaveBeenCalledWith(
      '/diagnostics/api/reports',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        redirect: 'error',
      }),
    );

    expect(sessionStorage.getItem(REPORT_TRANSFER_KEY)).toBeNull();
  });

  it('keeps unsent data and reports upload failure without success-shaped fallback', async () => {
    pending();

    await import('../src/diagnostics-page');

    fetch.mockResolvedValueOnce(new Response('', { status: 503 }));

    button('send-report').click();

    await vi.waitFor(() => {
      expect(status()).toContain('503');
    });

    expect(button('send-report').disabled).toBe(false);

    expect(sessionStorage.getItem(REPORT_TRANSFER_KEY)).not.toBeNull();
  });

  it('requires a valid storage acknowledgement before clearing the pending report', async () => {
    pending();

    await import('../src/diagnostics-page');

    fetch.mockResolvedValueOnce(Response.json({}));

    button('send-report').click();

    await vi.waitFor(() => {
      expect(status()).toContain('não confirmou');
    });

    expect(sessionStorage.getItem(REPORT_TRANSFER_KEY)).not.toBeNull();
  });

  it('blocks upload when the pending report expires after opening', async () => {
    pending(Date.now() + 1000);

    await import('../src/diagnostics-page');

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000);

    button('send-report').click();

    await vi.waitFor(() => {
      expect(status()).toContain('expirou');
    });

    expect(fetch).not.toHaveBeenCalled();

    expect(button('send-report').disabled).toBe(true);
  });

  it.each(['{', JSON.stringify({ expires: 0, report: {} })])(
    'reports malformed/expired transfer data',
    async (value) => {
      sessionStorage.setItem(REPORT_TRANSFER_KEY, value);

      await import('../src/diagnostics-page');

      expect(status()).not.toBe('');

      expect(button('send-report').disabled).toBe(true);
    },
  );

  it('lists, paginates, downloads and explicitly deletes reports', async () => {
    await import('../src/diagnostics-page');

    fetch.mockResolvedValueOnce(Response.json({ cursor: 'page 2', reports: [{ id }] }));

    button('refresh-reports').click();

    await vi.waitFor(() => {
      expect(document.querySelector('#stored-reports a')?.getAttribute('href')).toContain(id);
    });

    expect(button('next-reports').hidden).toBe(false);

    button('next-reports').click();

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/diagnostics/api/reports?cursor=page%202',
        expect.any(Object),
      );
    });

    fetch.mockResolvedValueOnce(Response.json({ cursor: null, reports: [{ id }] }));

    button('refresh-reports').click();

    await vi.waitFor(() => {
      expect(document.querySelector('#stored-reports button')).not.toBeNull();
    });

    const remove = document.querySelector<HTMLButtonElement>('#stored-reports button');

    if (!remove) throw new Error('Missing delete button.');

    remove.click();

    await vi.waitFor(() => {
      expect(status()).toBe('Relatório apagado.');
    });

    expect(fetch).toHaveBeenCalledWith(
      `/diagnostics/api/reports/${id}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it.each([[], { cursor: 42, reports: [] }, { cursor: null, reports: [{ id: '<script>' }] }])(
    'rejects invalid report lists',
    async (value) => {
      await import('../src/diagnostics-page');

      fetch.mockResolvedValueOnce(Response.json(value));

      button('refresh-reports').click();

      await vi.waitFor(() => {
        expect(status()).toContain('não é válida');
      });
    },
  );

  it('reports delete and discard failures', async () => {
    await import('../src/diagnostics-page');

    fetch.mockResolvedValueOnce(Response.json({ cursor: null, reports: [{ id }] }));

    button('refresh-reports').click();

    await vi.waitFor(() => {
      expect(document.querySelector('#stored-reports button')).not.toBeNull();
    });

    fetch.mockRejectedValueOnce(new Error('offline'));

    document.querySelector<HTMLButtonElement>('#stored-reports button')?.click();

    await vi.waitFor(() => {
      expect(status()).toBe('offline');
    });

    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage denied');
    });

    button('discard-report').click();

    expect(status()).toBe('storage denied');
  });
});
