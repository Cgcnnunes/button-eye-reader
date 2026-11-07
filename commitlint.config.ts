import type { UserConfig } from '@commitlint/types';
import { RuleConfigSeverity } from '@commitlint/types';
import { git, lines } from './scripts/git.ts';
import { nextCommitNumber, parseSubject } from './scripts/policy.ts';

const config: UserConfig = {
  defaultIgnores: false,
  plugins: [
    {
      rules: {
        'reader-sequence': ({ header }: { header?: string | null }): [boolean, string] => {
          try {
            const parsed = parseSubject(header ?? '');
            const expected = nextCommitNumber(lines(git('log', 'HEAD', '--format=%s')));

            return [
              parsed.number === expected,
              `Expected reader-${String(expected).padStart(5, '0')}. Run npm run commit:next.`,
            ];
          } catch (error) {
            return [false, error instanceof Error ? error.message : 'Cannot validate sequence.'];
          }
        },
        'reader-subject': ({ header }: { header?: string | null }): [boolean, string] => {
          try {
            parseSubject(header ?? '');

            return [true, ''];
          } catch (error) {
            return [false, error instanceof Error ? error.message : 'Invalid commit subject.'];
          }
        },
      },
    },
  ],
  rules: {
    'reader-sequence': [RuleConfigSeverity.Error, 'always'],
    'reader-subject': [RuleConfigSeverity.Error, 'always'],
  },
};

export default config;
