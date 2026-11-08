interface WorkerEnvironment {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

async function serve(request: Request, environment: WorkerEnvironment): Promise<Response> {
  return environment.ASSETS.fetch(request);
}

export default { fetch: serve };
