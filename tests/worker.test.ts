import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/worker';

interface TestElement {
  setAttribute(name: string, value: string): this;
}

interface TestHandler {
  element(element: TestElement): void;
}

const rewrite = {
  on: vi.fn<(selector: string) => void>(),
  setAttribute: vi.fn<(name: string, value: string) => void>(),
};

class TestElementStub implements TestElement {
  setAttribute(name: string, value: string): this {
    rewrite.setAttribute(name, value);

    return this;
  }
}

class MockHTMLRewriter {
  private handler: TestHandler | null = null;

  on(selector: string, handler: TestHandler): this {
    rewrite.on(selector);

    this.handler = handler;

    return this;
  }

  transform(response: Response): Response {
    if (!this.handler) throw new Error('No HTML element handler was configured.');

    this.handler.element(new TestElementStub());

    return response;
  }
}

describe('production eye-debug header gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.stubGlobal('HTMLRewriter', MockHTMLRewriter);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serves the static HTML unchanged when the opt-in header is missing', async () => {
    const asset = new Response('<html></html>', {
      headers: { 'content-type': 'text/html' },
    });

    const response = await worker.fetch(new Request('https://reader.example/'), {
      ASSETS: { fetch: () => Promise.resolve(asset) },
      DEPLOYMENT_ENVIRONMENT: 'production',
    });

    expect(response).toBe(asset);

    expect(rewrite.on).not.toHaveBeenCalled();
  });

  it('does not enable diagnostics outside the production environment', async () => {
    const asset = new Response('<html></html>', {
      headers: { 'content-type': 'text/html' },
    });

    const response = await worker.fetch(
      new Request('https://reader.example/', { headers: { 'x-test-production': 'true' } }),
      {
        ASSETS: { fetch: () => Promise.resolve(asset) },
        DEPLOYMENT_ENVIRONMENT: 'test',
      },
    );

    expect(response).toBe(asset);

    expect(rewrite.on).not.toHaveBeenCalled();
  });

  it('does not rewrite non-HTML assets when the opt-in header is present', async () => {
    const asset = new Response('asset', {
      headers: { 'content-type': 'application/javascript' },
    });

    const response = await worker.fetch(
      new Request('https://reader.example/assets/app.js', {
        headers: { 'x-test-production': 'true' },
      }),
      {
        ASSETS: { fetch: () => Promise.resolve(asset) },
        DEPLOYMENT_ENVIRONMENT: 'production',
      },
    );

    expect(response).toBe(asset);

    expect(rewrite.on).not.toHaveBeenCalled();
  });

  it('injects the diagnostic flag and prevents caching of the modified HTML', async () => {
    const asset = new Response('<html></html>', {
      headers: {
        'content-encoding': 'br',
        'content-length': '13',
        'content-type': 'text/html',
        etag: '"original"',
        vary: 'Accept-Encoding',
      },
    });

    const response = await worker.fetch(
      new Request('https://reader.example/', { headers: { 'x-test-production': 'true' } }),
      {
        ASSETS: { fetch: () => Promise.resolve(asset) },
        DEPLOYMENT_ENVIRONMENT: 'production',
      },
    );

    expect(rewrite.on).toHaveBeenCalledWith('html');

    expect(rewrite.setAttribute).toHaveBeenCalledWith('data-eye-debug', 'true');

    expect(response.headers.get('cache-control')).toBe('no-store');

    expect(response.headers.get('vary')).toBe('Accept-Encoding, x-test-production');

    expect(response.headers.has('content-encoding')).toBe(false);

    expect(response.headers.has('content-length')).toBe(false);

    expect(response.headers.has('etag')).toBe(false);
  });
});
