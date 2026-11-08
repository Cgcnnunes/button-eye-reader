interface Environment {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

async function serve(request: Request, environment: Environment): Promise<Response> {
  return environment.ASSETS.fetch(request);
}

export default { fetch: serve };
