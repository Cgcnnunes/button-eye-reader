import { describe, expect, it, vi } from 'vitest';
import worker from '../src/worker';

describe('static asset Worker', () => {
  it.each(['/', '/index.html', '/assets/app.js'])('serves %s unchanged', async (path) => {
    const asset = new Response('asset');
    const fetch = vi.fn<(request: Request) => Promise<Response>>().mockResolvedValue(asset);
    const request = new Request(`https://reader.example${path}`);

    const response = await worker.fetch(request, { ASSETS: { fetch } });

    expect(fetch).toHaveBeenCalledWith(request);

    expect(response).toBe(asset);
  });
});
