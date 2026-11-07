import { execFileSync } from 'node:child_process';

export function git(...args: string[]): string {
  return execFileSync('git', ['--no-pager', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function lines(value: string): string[] {
  return value.split(/\r?\n/).filter(Boolean);
}
