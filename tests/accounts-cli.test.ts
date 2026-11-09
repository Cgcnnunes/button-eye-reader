import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invitationSql, parseArguments, runAccountCommand } from '../scripts/accounts';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('authenticated Wrangler invitation/reset CLI', () => {
  it('uses inline JSON queries and prints only the confirmed private link', () => {
    vi.mocked(spawnSync).mockReturnValue({
      output: [],
      pid: 1,
      signal: null,
      status: 0,
      stderr: '',
      stdout: JSON.stringify([{ results: [{ account_id: 'account-id' }], success: true }]),
    });

    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    runAccountCommand([
      'invite',
      '--env',
      'test',
      '--username',
      'caregiver',
      '--origin',
      'https://reader.example',
    ]);

    const args = vi.mocked(spawnSync).mock.calls[0][1];

    expect(args).toContain('--command');

    expect(args).toContain('--json');

    expect(args).not.toContain('--file');

    expect(write).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/reader\.example\/#setup=[a-f0-9]{64}\n$/),
    );
  });

  it('does not print a link on failed execution, malformed confirmation or missing accounts', () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    for (const [status, stdout, error] of [
      [1, '', 'D1 operation failed'],
      [0, '├ Checking if file needs uploading', 'account may already exist'],
      [0, '[{"results":[]}]', 'Account not found'],
    ] as const) {
      vi.mocked(spawnSync).mockReturnValue({
        output: [],
        pid: 1,
        signal: null,
        status,
        stderr: '',
        stdout,
      });

      expect(() => {
        runAccountCommand([
          'reset',
          '--env',
          'test',
          '--username',
          'caregiver',
          '--origin',
          'https://reader.example',
        ]);
      }).toThrow(error);
    }

    expect(write).not.toHaveBeenCalled();
  });

  it('accepts explicit remote environment/origin or local TEST only', () => {
    expect(
      parseArguments([
        'invite',
        '--env',
        'test',
        '--username',
        'Caregiver',
        '--origin',
        'https://reader.example',
      ]),
    ).toEqual({
      environment: 'test',
      local: false,
      mode: 'invite',
      origin: 'https://reader.example',
      username: 'caregiver',
    });

    expect(
      parseArguments([
        'reset',
        '--env',
        'test',
        '--username',
        'caregiver',
        '--origin',
        'http://localhost:8787',
        '--local',
      ]).local,
    ).toBe(true);

    expect(
      parseArguments([
        'reset',
        '--env',
        'production',
        '--username',
        'caregiver',
        '--origin',
        'https://reader.example',
      ]).environment,
    ).toBe('production');
  });

  it('rejects ambiguous commands, unsafe origins, passwords and invalid usernames', () => {
    const valid = [
      'invite',
      '--env',
      'test',
      '--username',
      'caregiver',
      '--origin',
      'https://reader.example',
    ];

    for (const options of [
      [],
      ['invite'],
      [...valid, '--password', 'never-accepted'],
      [...valid, '--env', 'test'],
      [...valid, '--local', '--local'],
      [...valid, '--username'],
      ['unknown', ...valid.slice(1)],
      ['invite', '--env', 'test', '--username', '!', '--origin', 'https://reader.example'],
      ['invite', '--env', 'test', '--username', 'caregiver', '--origin', 'http://reader.example'],
      [
        'invite',
        '--env',
        'production',
        '--username',
        'caregiver',
        '--origin',
        'http://localhost',
        '--local',
      ],
      [
        'invite',
        '--env',
        'test',
        '--username',
        'caregiver',
        '--origin',
        'https://user:pass@reader.example',
      ],
      [
        'invite',
        '--env',
        'test',
        '--username',
        'caregiver',
        '--origin',
        'https://reader.example/path',
      ],
      [
        'invite',
        '--env',
        'test',
        '--username',
        'caregiver',
        '--origin',
        'https://reader.example/#setup=secret',
      ],
    ]) {
      expect(() => parseArguments(options)).toThrow();
    }
  });

  it('initializes only invited accounts and replaces one expiring hashed recovery token', () => {
    const command = parseArguments([
      'invite',
      '--env',
      'test',
      '--username',
      'caregiver',
      '--origin',
      'https://reader.example',
    ]);
    const sql = invitationSql(command, 'a'.repeat(64), 123456);

    expect(sql).toContain('INSERT INTO accounts');

    expect(sql).toContain('INSERT INTO account_tokens');

    expect(sql).toContain('123456');

    expect(sql).toContain('ON CONFLICT(account_id)');

    expect(sql).toContain('"version":1');

    expect(sql).not.toContain('password_hash');

    expect(invitationSql({ ...command, mode: 'reset' }, 'a'.repeat(64), 123456)).not.toContain(
      'INSERT INTO accounts',
    );
  });
});
