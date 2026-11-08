import './diagnostics-style.css';
import {
  type DiagnosticReport,
  isDiagnosticReport,
  MAX_REPORT_BYTES,
  REPORT_TRANSFER_KEY,
} from './diagnostics';

function element<T extends HTMLElement>(id: string, expected: new () => T): T {
  const found = document.getElementById(id);

  if (!(found instanceof expected)) throw new Error(`Missing diagnostic element: ${id}`);

  return found;
}

const status = element('report-status', HTMLParagraphElement);
const preview = element('pending-report', HTMLPreElement);
const send = element('send-report', HTMLButtonElement);
const list = element('stored-reports', HTMLUListElement);
let pending: DiagnosticReport | null = null;
let pendingExpires = 0;
let nextCursor: string | null = null;

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Erro desconhecido.';
}

async function request(path: string, options?: RequestInit): Promise<unknown> {
  const response = await fetch(`/diagnostics/api/reports${path}`, {
    ...options,
    cache: 'no-store',
    redirect: 'error',
  });

  if (!response.ok)
    throw new Error(
      `O pedido de relatórios falhou (${response.status}). Verifique o acesso e tente novamente.`,
    );

  return response.json() as Promise<unknown>;
}

function discard(): void {
  sessionStorage.removeItem(REPORT_TRANSFER_KEY);

  pending = null;

  preview.textContent = '';

  send.disabled = true;
}

async function refresh(cursor?: string): Promise<void> {
  const result = await request(cursor ? `?cursor=${encodeURIComponent(cursor)}` : '');

  if (
    typeof result !== 'object' ||
    result === null ||
    !('reports' in result) ||
    !Array.isArray(result.reports) ||
    !('cursor' in result) ||
    (result.cursor !== null && typeof result.cursor !== 'string')
  ) {
    throw new Error('A lista de relatórios não é válida.');
  }

  const reports: unknown[] = result.reports;

  nextCursor = result.cursor;

  element('next-reports', HTMLButtonElement).hidden = !nextCursor;

  list.replaceChildren();

  for (const item of reports) {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('id' in item) ||
      typeof item.id !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(item.id)
    ) {
      throw new Error('A identificação do relatório não é válida.');
    }

    const id = item.id;
    const row = document.createElement('li');
    const link = document.createElement('a');
    const remove = document.createElement('button');

    link.href = `/diagnostics/api/reports/${id}`;

    link.textContent = `Descarregar ${id}`;

    remove.textContent = 'Apagar';

    remove.addEventListener('click', () => {
      void (async (): Promise<void> => {
        try {
          await request(`/${id}`, { method: 'DELETE' });

          await refresh();

          status.textContent = 'Relatório apagado.';
        } catch (error) {
          status.textContent = message(error);
        }
      })();
    });

    row.append(link, remove);

    list.append(row);
  }

  status.textContent = `${reports.length} relatórios nesta página.`;
}

try {
  const stored = sessionStorage.getItem(REPORT_TRANSFER_KEY);

  if (stored) {
    let value: unknown;

    try {
      value = JSON.parse(stored);
    } catch {
      discard();

      throw new Error('O relatório pendente não é válido. Faça uma nova sessão.');
    }

    if (
      stored.length > MAX_REPORT_BYTES ||
      typeof value !== 'object' ||
      value === null ||
      !('report' in value) ||
      !isDiagnosticReport(value.report) ||
      !('expires' in value) ||
      typeof value.expires !== 'number' ||
      !Number.isFinite(value.expires) ||
      value.expires <= Date.now()
    ) {
      discard();

      throw new Error('O relatório pendente expirou ou não é válido. Faça uma nova sessão.');
    }

    pending = value.report;

    pendingExpires = value.expires;

    preview.textContent = JSON.stringify(pending, null, 2);

    send.disabled = false;
  }
} catch (error) {
  status.textContent = message(error);
}

send.addEventListener('click', () => {
  if (!pending) return;

  send.disabled = true;

  void (async (): Promise<void> => {
    let uploadConfirmed = false;

    try {
      if (pendingExpires <= Date.now()) {
        discard();

        throw new Error('O relatório pendente expirou. Faça uma nova sessão.');
      }

      const result = await request('', {
        body: JSON.stringify(pending),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      if (
        typeof result !== 'object' ||
        result === null ||
        !('id' in result) ||
        typeof result.id !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(result.id) ||
        !('expires' in result) ||
        typeof result.expires !== 'number' ||
        !Number.isFinite(result.expires) ||
        result.expires <= Date.now()
      ) {
        throw new Error('O servidor não confirmou que o relatório foi guardado.');
      }

      uploadConfirmed = true;

      discard();

      await refresh();

      status.textContent = 'Relatório enviado. Disponível durante sete dias.';
    } catch (error) {
      send.disabled = uploadConfirmed || !pending;

      status.textContent = uploadConfirmed
        ? `Relatório guardado, mas a atualização local falhou. ${message(error)}`
        : message(error);
    }
  })();
});

element('discard-report', HTMLButtonElement).addEventListener('click', () => {
  try {
    discard();

    status.textContent = 'Relatório pendente descartado.';
  } catch (error) {
    status.textContent = message(error);
  }
});

element('refresh-reports', HTMLButtonElement).addEventListener('click', () => {
  void refresh().catch((error: unknown) => {
    status.textContent = message(error);
  });
});

element('next-reports', HTMLButtonElement).addEventListener('click', () => {
  if (!nextCursor) return;

  void refresh(nextCursor).catch((error: unknown) => {
    status.textContent = message(error);
  });
});
