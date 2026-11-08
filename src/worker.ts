import { isReportPath, purgeReports, type ReportEnvironment, serveReports } from './report-storage';

async function serve(request: Request, environment: ReportEnvironment): Promise<Response> {
  if (isReportPath(new URL(request.url).pathname)) return serveReports(request, environment);

  return environment.ASSETS.fetch(request);
}

async function scheduled(_event: unknown, environment: ReportEnvironment): Promise<void> {
  await purgeReports(environment);
}

export default { fetch: serve, scheduled };
