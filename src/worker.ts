interface RewrittenElement {
  setAttribute(name: string, value: string): RewrittenElement;
}

interface ElementHandler {
  element(element: RewrittenElement): void;
}

interface Rewriter {
  on(selector: string, handler: ElementHandler): Rewriter;

  transform(response: Response): Response;
}

declare const HTMLRewriter: new () => Rewriter;

interface WorkerEnvironment {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DEPLOYMENT_ENVIRONMENT: string;
}

async function serve(request: Request, environment: WorkerEnvironment): Promise<Response> {
  const response = await environment.ASSETS.fetch(request);
  const contentType = response.headers.get('content-type');

  if (
    environment.DEPLOYMENT_ENVIRONMENT !== 'production' ||
    request.headers.get('x-test-production') !== 'true' ||
    !contentType?.toLowerCase().includes('text/html')
  ) {
    return response;
  }

  const rewritten = new HTMLRewriter()
    .on('html', {
      element(element): void {
        element.setAttribute('data-eye-debug', 'true');
      },
    })
    .transform(response);
  const headers = new Headers(rewritten.headers);
  const vary = headers.get('Vary');

  headers.delete('Content-Encoding');

  headers.delete('Content-Length');

  headers.delete('ETag');

  headers.set('Cache-Control', 'no-store');

  headers.set('Vary', vary ? `${vary}, x-test-production` : 'x-test-production');

  return new Response(rewritten.body, {
    headers,
    status: rewritten.status,
    statusText: rewritten.statusText,
  });
}

export default { fetch: serve };
