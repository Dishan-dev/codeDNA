import type { IconName } from '@codedna/learn-ui';
import type { RepoBundle } from '@codedna/shared';
import type { ProjectStatus } from './projects';

export interface NextStep {
  id: string;
  title: string;
  text: string;
  /** Relative to the repo, e.g. "/quality". */
  path: string;
  icon: IconName;
  tone: 'danger' | 'warning' | 'accent' | 'muted';
}

type Rule = (bundle: RepoBundle, status: ProjectStatus, nextLesson?: string) => NextStep | undefined;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * What to do next on a project, most urgent first. Each rule looks at one thing; to suggest
 * something new, add a rule. Rules only read the status, so they are cheap and easy to test.
 */
const RULES: readonly Rule[] = [
  (_bundle, status) =>
    status.qa?.failed
      ? { id: 'qa-failed', title: `Fix ${plural(status.qa.failed, 'failed check')}`, text: 'The last QA run found things that broke. Each one links to its flow.', path: '/quality', icon: 'unknown', tone: 'danger' }
      : undefined,
  (_bundle, status) =>
    status.coverage !== undefined && status.coverage < 100
      ? { id: 'coverage', title: `Requirements are ${status.coverage}% covered`, text: 'See which requirements look missing or only partly built.', path: '/requirements', icon: 'form', tone: status.coverage < 50 ? 'warning' : 'accent' }
      : undefined,
  (_bundle, status) =>
    status.risks ? { id: 'risks', title: `Look at ${plural(status.risks, 'risky flow')}`, text: 'Places in the code with missing checks or unhandled errors.', path: '/quality', icon: 'check', tone: 'warning' } : undefined,
  (bundle, status) =>
    status.coverage === undefined
      ? { id: 'no-srs', title: 'Check it against the requirements', text: `Drop in the SRS or client brief to see how much of ${bundle.name.replace(/^.*\//, '')} is built.`, path: '/requirements', icon: 'form', tone: 'accent' }
      : undefined,
  (_bundle, status) =>
    status.qa ? undefined : { id: 'no-qa', title: 'Run the QA agent', text: 'Run your tests and walk each page in a real browser, on your computer.', path: '/quality', icon: 'terminal', tone: 'accent' },
  (bundle, _status, nextLesson) => {
    const lesson = nextLesson ? bundle.plan.lessons[nextLesson] : undefined;
    return lesson ? { id: 'lesson', title: `Continue: ${lesson.title}`, text: 'The next lesson on your path.', path: `/learn/${lesson.id}`, icon: 'play', tone: 'accent' } : undefined;
  },
];

export function nextSteps(bundle: RepoBundle, status: ProjectStatus, nextLesson?: string): NextStep[] {
  return RULES.map((rule) => rule(bundle, status, nextLesson)).filter((step): step is NextStep => !!step);
}
