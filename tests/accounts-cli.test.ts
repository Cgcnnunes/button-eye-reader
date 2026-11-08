import { describe, expect, it } from 'vitest';
import { invitationSql, parseArguments } from '../scripts/accounts';

describe('authenticated Wrangler invitation/reset CLI', () => {
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
