'use client';
import Link from 'next/link';
import { Icon, type IconName } from '@codedna/learn-ui';
import { projectStore, useProjects, type ProjectRecord } from '@/lib/projects';
import { cn } from '@/lib/utils';
import { Brand, ButtonLink, focus } from './ui';

const SOURCE: Record<ProjectRecord['source'], { label: string; icon: IconName }> = {
  github: { label: 'GitHub', icon: 'github' },
  local: { label: 'This computer', icon: 'terminal' },
  starter: { label: 'Starter app', icon: 'book' },
};

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} day${days === 1 ? '' : 's'} ago` : new Date(iso).toLocaleDateString();
}

function Stat({ label, value, tone = 'ink' }: { label: string; value: string; tone?: 'ink' | 'danger' | 'warning' | 'muted' }) {
  return (
    <div className="rounded-xl bg-surface-2/70 px-3 py-2">
      <dt className="text-[11.5px] text-muted">{label}</dt>
      <dd className={cn('text-[16px] font-semibold tabular-nums', tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : tone === 'muted' ? 'text-muted' : 'text-ink')}>{value}</dd>
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectRecord }) {
  const short = project.name.replace(/^.*\//, '');
  const source = SOURCE[project.source];
  const percent = project.lessons.total ? Math.round((project.lessons.done / project.lessons.total) * 100) : 0;
  return (
    <li className="flex flex-col rounded-3xl border border-line bg-surface p-5 shadow-card transition-shadow hover:shadow-lift sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent/90 to-accent/60 text-[16px] font-bold uppercase text-on-accent" aria-hidden="true">
          {short.charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[17px] font-semibold text-ink">{short}</h2>
          <p className="flex items-center gap-1.5 truncate text-[12.5px] text-muted">
            <Icon name={source.icon} className="h-3.5 w-3.5 shrink-0" />
            {`${source.label} · ${project.framework.replace(/\s*\(.*\)$/, '')} · ${ago(project.lastOpened)}`}
          </p>
        </div>
      </div>
      <div className="mt-5">
        <div className="flex items-center justify-between text-[12.5px]">
          <span className="font-medium text-ink">{`${project.lessons.done} of ${project.lessons.total} lessons`}</span>
          <span className="tabular-nums text-muted">{`${percent}%`}</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
          <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="Requirements" value={project.coverage === undefined ? '—' : `${project.coverage}%`} tone={project.coverage === undefined ? 'muted' : 'ink'} />
        <Stat label="Risky flows" value={String(project.risks)} tone={project.risks ? 'warning' : 'ink'} />
        <Stat label="QA run" value={project.qa ? (project.qa.failed ? `${project.qa.failed} failed` : 'Passed') : '—'} tone={project.qa ? (project.qa.failed ? 'danger' : 'ink') : 'muted'} />
      </dl>
      {project.source === 'local' ? <p className="mt-3 text-[12px] leading-relaxed text-muted">Served from your computer: run “codedna” in its folder to open it.</p> : null}
      <div className="mt-5 flex items-center gap-2 pt-1">
        <ButtonLink href={`/r/${project.id}/overview`} className="h-10 min-h-0 flex-1 text-[14px]">
          {`Open ${short}`}
        </ButtonLink>
        <button type="button" onClick={() => projectStore.remove(project.id)} aria-label={`Remove ${short} from this list`} title="Remove from this list" className={cn('grid h-10 w-10 place-items-center rounded-xl border border-line text-muted hover:border-danger/40 hover:text-danger', focus)}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
            <path d="M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" />
          </svg>
        </button>
      </div>
    </li>
  );
}

/** Every project opened in this browser, with where each one stands. */
export function ProjectsPage() {
  const projects = useProjects();
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Brand />
          <ButtonLink href="/#start" icon="github" className="h-10 min-h-0 px-4 text-sm">
            Add a project
          </ButtonLink>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 pb-24 pt-10 sm:px-6 sm:pt-14 lg:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Your work</p>
        <h1 className="mt-2 text-[34px] font-semibold tracking-tight text-ink sm:text-[44px]">Projects</h1>
        <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-muted">Every app you’ve opened in this browser, with how far you’ve learned it, how much of the brief is built and what the last QA run found. The list stays in this browser.</p>
        {projects.length ? (
          <ul className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </ul>
        ) : (
          <div className="mt-10 rounded-3xl border border-dashed border-line bg-surface/60 px-6 py-14 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent" aria-hidden="true">
              <Icon name="book" className="h-7 w-7" />
            </span>
            <h2 className="mt-4 text-[20px] font-semibold text-ink">No projects yet</h2>
            <p className="mx-auto mt-1 max-w-md text-[15px] text-muted">Open an app and it shows up here, with its progress.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <ButtonLink href="/r/snackshop/overview" icon="play">
                Try the sample app
              </ButtonLink>
              <Link href="/#start" className={cn('inline-flex min-h-[44px] items-center rounded-xl border border-line bg-surface px-4 text-[15px] font-medium text-ink hover:border-accent/50', focus)}>
                Learn my own app
              </Link>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
