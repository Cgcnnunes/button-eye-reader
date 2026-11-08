import { describe, expect, it, vi } from 'vitest';
import worker from '../src/worker';

describe('static asset Worker', () => {
  it.each([
    ['/', undefined, 'text/html'],
    ['/', 'true', 'text/html'],
    ['/assets/app.js', undefined, 'application/javascript'],
  ])('serves %s unchanged with diagnostic header %s', async (path, header, contentType) => {
    const asset = new Response('asset', { headers: { 'content-type': contentType } });
    const fetch = vi.fn<(request: Request) => Promise<Response>>().mockResolvedValue(asset);
    const request = new Request(`https://reader.example${path}`, {
      headers: header ? { 'x-test-production': header } : undefined,
    });

    const response = await worker.fetch(request, { ASSETS: { fetch } });

    expect(fetch).toHaveBeenCalledWith(request);

    expect(response).toBe(asset);
  });
});
