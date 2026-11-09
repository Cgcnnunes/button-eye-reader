import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultBoard } from '../src/store.ts';

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export interface AccountCommand {
  environment: 'production' | 'test';
  local: boolean;
  mode: 'invite' | 'reset';
  origin: string;
  username: string;
}

export function parseArguments(args: string[]): AccountCommand {
  const [mode, ...options] = args;
  const allowed = new Set(['--env', '--username', '--origin', '--local']);
  const values = new Map<string, string>();
  let local = false;

  for (let index = 0; index < options.length; index++) {
    const option = options[index];

    if (!allowed.has(option) || values.has(option)) {
      throw new Error('Unknown or repeated option.');
    }

    if (option === '--local') {
      if (local) {
        throw new Error('Repeated --local option.');
      }

      local = true;
    } else {
      const value = options[++index];

      if (!value || value.startsWith('--')) {
        throw new Error('Missing option value.');
      }

      values.set(option, value);
    }
  }

  const environment = values.get('--env');
  const username = values.get('--username')?.toLowerCase();
  const origin = new URL(values.get('--origin') ?? '');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);

  if (
    (mode !== 'invite' && mode !== 'reset') ||
    (environment !== 'test' && environment !== 'production') ||
    !username ||
    !/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(username) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== 'https:' && !(local && loopback && origin.protocol === 'http:')) ||
    (local && environment !== 'test')
  ) {
    throw new Error(
      'Use invite|reset --env test|production --username NAME --origin HTTPS_ORIGIN [--local].',
    );
  }

  return { environment, local, mode, origin: origin.origin, username };
}

export function invitationSql(
  command: AccountCommand,
  tokenHash: string,
  expiresAt: number,
): string {
  const name = quote(command.username);
  const insert =
    command.mode === 'invite'
      ? `INSERT INTO accounts (id, username, board) VALUES (${quote(randomUUID())}, ${name}, ${quote(JSON.stringify(defaultBoard()))});`
      : '';

  return `${insert}
INSERT INTO account_tokens (token_hash, account_id, expires_at)
SELECT ${quote(tokenHash)}, id, ${expiresAt} FROM accounts WHERE username = ${name}
ON CONFLICT(account_id) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at
RETURNING account_id;
`;
}

export function runAccountCommand(args: string[]): void {
  const command = parseArguments(args);
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  const executable = resolve('node_modules', 'wrangler', 'bin', 'wrangler.js');
  const result = spawnSync(
    process.execPath,
    [
      executable,
      'd1',
      'execute',
      'DB',
      '--env',
      command.environment,
      command.local ? '--local' : '--remote',
      '--command',
      invitationSql(command, hash, Math.floor(Date.now() / 1000) + 24 * 60 * 60),
      '--json',
    ],
    { encoding: 'utf8', windowsHide: true },
  );

  if (result.status !== 0) {
    throw new Error(
      'D1 operation failed. Check authenticated Wrangler access, binding IDs and migrations. No link was issued.',
    );
  }

  let output: unknown;

  try {
    output = JSON.parse(result.stdout) as unknown;
  } catch {
    throw new Error(
      'D1 returned invalid confirmation output. The account may already exist; use reset with the same username to recover a setup link. No link was issued.',
    );
  }

  if (
    !Array.isArray(output) ||
    !output.some(
      (item: unknown) =>
        typeof item === 'object' &&
        item !== null &&
        'results' in item &&
        Array.isArray(item.results) &&
        item.results.some(
          (row: unknown) =>
            typeof row === 'object' &&
            row !== null &&
            'account_id' in row &&
            typeof row.account_id === 'string',
        ),
    )
  ) {
    throw new Error('Account not found or D1 did not confirm token issuance. No link was issued.');
  }

  process.stdout.write(`${command.origin}/#setup=${token}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    runAccountCommand(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Account operation failed.'}\n`,
    );

    process.exitCode = 1;
  }
}
