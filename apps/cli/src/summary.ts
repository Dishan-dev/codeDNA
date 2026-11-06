import type { LearningPlan, RepoAnalysis } from '@codedna/shared';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** A short, plain-language overview for the terminal. */
export function formatSummary(name: string, analysis: RepoAnalysis, plan?: LearningPlan): string {
  const lines: string[] = [];
  const pages = analysis.routes.filter((route) => route.kind === 'page').length;
  lines.push(`CodeDNA · ${name}`);
  lines.push(`${analysis.framework.label} · ${plural(analysis.stats.files, 'file')} · ${plural(pages, 'page')}`);
  lines.push('');

  if (!analysis.supported) {
    lines.push(...analysis.limitations);
    return lines.join('\n');
  }
  if (!analysis.features.length) lines.push('CodeDNA found no buttons, forms or API routes to follow yet.');
  else {
    lines.push(`What people can do in this app (${plural(analysis.features.length, 'feature')}):`);
    const pageWidth = Math.min(24, Math.max(...analysis.features.map((feature) => (feature.page ?? '').length)));
    const titleWidth = Math.min(36, Math.max(...analysis.features.map((feature) => feature.title.length)));
    for (const feature of analysis.features) {
      const gaps = feature.steps.filter((step) => step.confidence === 'gap').length;
      const details = [plural(feature.steps.length, 'step'), ...(feature.branches.length ? [plural(feature.branches.length, 'check')] : []), ...(gaps ? [plural(gaps, 'unknown part')] : [])];
      lines.push(`  ${(feature.page ?? '').padEnd(pageWidth)}  ${feature.title.padEnd(titleWidth)}  ${details.join(' · ')}`);
    }
  }
  const unknown = analysis.features.reduce((count, feature) => count + feature.steps.filter((step) => step.confidence === 'gap').length, 0);
  if (unknown) {
    lines.push('');
    lines.push(`${plural(unknown, 'part')} can only be known while the app runs. The lessons explain each one.`);
  }
  if (plan?.path.length) {
    lines.push('');
    lines.push(`Learning path: ${plural(plan.path.length, 'lesson')}, easiest first.`);
  }
  if (plan?.hiddenLessons.length) {
    lines.push('');
    lines.push('Lessons hidden in your app:');
    for (const hidden of plan.hiddenLessons) lines.push(`  • ${hidden.title}`);
  }
  for (const limitation of analysis.limitations) lines.push(limitation);
  lines.push('');
  lines.push('Your code was read on this computer and never left it.');
  return lines.join('\n');
}
