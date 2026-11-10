'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '@codedna/learn-ui';
import type { ConceptId, LearnerEvent, Progress, RepoBundle } from '@codedna/shared';
import { useBundle } from '@/lib/bundle';
import { useProgress } from '@/lib/progress-store';
import { projectStore, useProjectStatus, type ProjectStatus } from '@/lib/projects';
import { flowCounts, flowViews } from '@/lib/qa-flows';
import type { QaReportState } from '@/lib/qa-results';
import { cn } from '@/lib/utils';
import { ConceptDrawer } from './concept-drawer';
import { Brand, ButtonLink, Logo, PageMessage, focus } from './ui';

interface RepoContextValue {
  bundle: RepoBundle;
  progress: Progress;
  progressLoaded: boolean;
  dispatch: (event: LearnerEvent) => void;
  /** `/r/<repo>` */
  base: string;
  /** Open the Concept Card drawer (and count the concept as seen). */
  openConcept: (id: ConceptId) => void;
  /** Where the project stands: lessons, requirements coverage, risks, last QA run. */
  status: ProjectStatus;
  qa: QaReportState;
}
const RepoContext = createContext<RepoContextValue | undefined>(undefined);

export function useRepo(): RepoContextValue {
  const value = useContext(RepoContext);
  if (!value) throw new Error('useRepo must be used inside RepoShell');
  return value;
}

const NAV_KEY = 'codedna:nav-collapsed';
const SOURCE: Record<RepoBundle['source'], { label: string; icon: IconName }> = {
  github: { label: 'GitHub', icon: 'github' },
  local: { label: 'This computer', icon: 'terminal' },
  starter: { label: 'Starter app', icon: 'book' },
};

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  active: boolean;
  /** A small live count beside the label: lessons done, coverage, findings. */
  badge?: string | undefined;
  badgeTone?: 'accent' | 'warning' | 'muted';
}

/**
 * The repo's sidebar: which project you're in, the two jobs (understand the app, then deliver it
 * against what was asked), live counts on each, and your progress at the foot. It folds down to
 * icons on large screens and slides in as a drawer on phones. One nav for every size.
 */
function Sidebar({ bundle, base, progress, status, flowsBroken, collapsed, onCollapse, open, onClose }: { bundle: RepoBundle; base: string; progress: Progress; status: ProjectStatus; flowsBroken: number; collapsed: boolean; onCollapse: () => void; open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const done = status.lessons.done;
  const coverage = status.coverage;
  const failed = status.qa ? status.qa.failed : 0;
  const risky = status.risks + failed;
  // A page change on a phone closes the drawer.
  useEffect(() => onClose(), [pathname, onClose]);

  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: 'Project',
      items: [{ href: `${base}/overview`, label: 'Overview', icon: 'client', active: pathname.startsWith(`${base}/overview`) }],
    },
    {
      title: 'Understand',
      items: [
        { href: base, label: 'Learn', icon: 'book', active: pathname === base || pathname.startsWith(`${base}/learn`), badge: bundle.plan.path.length ? `${done}/${bundle.plan.path.length}` : undefined, badgeTone: 'accent' },
        { href: `${base}/map`, label: 'Map', icon: 'branch', active: pathname.startsWith(`${base}/map`) },
        { href: `${base}/features`, label: 'Features', icon: 'screen', active: pathname.startsWith(`${base}/features`) || pathname.startsWith(`${base}/story`) },
        { href: `${base}/skills`, label: 'Skills', icon: 'star', active: pathname.startsWith(`${base}/skills`) },
      ],
    },
    {
      title: 'Deliver',
      items: [
        { href: `${base}/requirements`, label: 'Requirements', icon: 'form', active: pathname.startsWith(`${base}/requirements`), badge: coverage === undefined ? undefined : `${coverage}%`, badgeTone: 'accent' },
        { href: `${base}/qa`, label: 'QA flows', icon: 'play', active: pathname.startsWith(`${base}/qa`), badge: flowsBroken ? String(flowsBroken) : undefined, badgeTone: 'warning' },
        { href: `${base}/quality`, label: 'Quality', icon: 'check', active: pathname.startsWith(`${base}/quality`), badge: risky ? String(risky) : undefined, badgeTone: 'warning' },
      ],
    },
  ];
  const source = SOURCE[bundle.source];
  const wide = !collapsed;

  return (
    <>
      {/* Phones: a scrim behind the open drawer. */}
      <div className={cn('fixed inset-0 z-40 bg-ink/30 backdrop-blur-[2px] transition-opacity lg:hidden', open ? 'opacity-100' : 'pointer-events-none opacity-0')} onClick={onClose} aria-hidden="true" />
      <nav
        aria-label="Repository"
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-line bg-surface transition-[transform,width] duration-300 ease-out',
          open ? 'translate-x-0 shadow-lift' : '-translate-x-full max-lg:invisible',
          'lg:translate-x-0 lg:shadow-none',
          wide ? 'lg:w-[264px]' : 'lg:w-[76px]',
        )}
      >
        {/* Brand and fold */}
        <div className={cn('flex h-16 shrink-0 items-center gap-2 px-4', !wide && 'lg:justify-center lg:px-0')}>
          <Link href="/" aria-label="CodeDNA home" className={cn('flex min-w-0 items-center gap-2.5 rounded-xl', focus)}>
            <Logo className="h-9 w-9 rounded-xl" />
            <span className={cn('text-[16px] font-semibold tracking-tight text-ink', !wide && 'lg:sr-only')}>CodeDNA</span>
          </Link>
          <button type="button" onClick={onClose} aria-label="Close menu" className={cn('ml-auto grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink lg:hidden', focus)}>
            <Icon name="back" className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onCollapse}
            aria-label={wide ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-expanded={wide}
            className={cn('ml-auto hidden h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink lg:grid', !wide && 'lg:absolute lg:-right-4 lg:top-5 lg:z-10 lg:ml-0 lg:border lg:border-line lg:bg-surface lg:shadow-card', focus)}
          >
            <Icon name={wide ? 'back' : 'next'} className="h-4 w-4" />
          </button>
        </div>

        {/* The project */}
        <div className={cn('px-3', !wide && 'lg:px-2')}>
          <div className={cn('flex items-center gap-3 rounded-2xl border border-line bg-bg/60 p-2.5', !wide && 'lg:justify-center lg:border-transparent lg:bg-transparent lg:p-1')} title={bundle.name}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent/90 to-accent/60 text-[14px] font-bold uppercase text-on-accent" aria-hidden="true">
              {bundle.name.replace(/^.*\//, '').charAt(0)}
            </span>
            <span className={cn('min-w-0 flex-1', !wide && 'lg:sr-only')}>
              <span className="block truncate text-[13.5px] font-semibold text-ink">{bundle.name.replace(/^.*\//, '')}</span>
              <span className="flex items-center gap-1 truncate text-[11.5px] text-muted">
                <Icon name={source.icon} className="h-3 w-3 shrink-0" />
                {`${source.label} · ${bundle.framework.label.replace(/\s*\(.*\)$/, '')}`}
              </span>
            </span>
          </div>
        </div>

        {/* Sections */}
        <div className={cn('mt-4 flex-1 overflow-y-auto px-3 pb-4', !wide && 'lg:px-2')}>
          {groups.map((group) => (
            <div key={group.title} className="mb-5">
              <p className={cn('mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted', !wide && 'lg:sr-only')}>{group.title}</p>
              {!wide ? <span className="mx-auto mb-2 hidden h-px w-8 bg-line lg:block" aria-hidden="true" /> : null}
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={item.active ? 'page' : undefined}
                      title={!wide ? item.label : undefined}
                      className={cn(
                        'group relative flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition-colors',
                        item.active ? 'bg-accent-soft text-ink' : 'text-muted hover:bg-surface-2 hover:text-ink',
                        !wide && 'lg:justify-center lg:px-0',
                        focus,
                      )}
                    >
                      <span className={cn('absolute left-0 top-2 h-6 w-[3px] rounded-r-full bg-accent transition-opacity', item.active ? 'opacity-100' : 'opacity-0', !wide && 'lg:-left-2')} aria-hidden="true" />
                      <Icon name={item.icon} className={cn('h-[18px] w-[18px] shrink-0', item.active ? 'text-accent' : 'text-muted group-hover:text-ink')} />
                      <span className={cn('flex-1 truncate', !wide && 'lg:sr-only')}>{item.label}</span>
                      {item.badge ? (
                        <span
                          className={cn(
                            'rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
                            item.badgeTone === 'warning' ? 'bg-warning-soft text-warning' : item.active ? 'bg-surface text-accent' : 'bg-surface-2 text-muted',
                            !wide && 'lg:hidden',
                          )}
                        >
                          {item.badge}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Your progress */}
        <div className={cn('shrink-0 border-t border-line p-3', !wide && 'lg:px-2')}>
          {wide ? null : (
            <div className="hidden flex-col items-center gap-2 py-1 lg:flex" role="group" aria-label="Your progress">
              <span className="text-[11px] font-semibold tabular-nums text-ink" title="XP">{`${progress.xp} XP`}</span>
              <span className="flex items-center gap-0.5 text-[11px] tabular-nums text-muted" title="Day streak">
                <Icon name="flame" className="h-3.5 w-3.5 text-warning" />
                {progress.streakDays}
              </span>
            </div>
          )}
          <div className={cn('rounded-2xl bg-bg/70 p-3', !wide && 'lg:hidden')} role="group" aria-label="Your progress">
            <div className="flex items-center justify-between text-[12px]">
              <span className="font-medium text-ink">{`${done} of ${bundle.plan.path.length} lessons`}</span>
              <span className="tabular-nums text-muted">{bundle.plan.path.length ? `${Math.round((done / bundle.plan.path.length) * 100)}%` : ''}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
              <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${bundle.plan.path.length ? (done / bundle.plan.path.length) * 100 : 0}%` }} />
            </div>
            <div className="mt-3 flex items-center gap-4 text-[12px] text-muted">
              <span className="inline-flex items-center gap-1.5" title="XP">
                <Icon name="star" className="h-3.5 w-3.5 text-accent" />
                <span className="font-semibold tabular-nums text-ink">{progress.xp}</span> XP
              </span>
              <span className="inline-flex items-center gap-1.5" title="Day streak">
                <Icon name="flame" className="h-3.5 w-3.5 text-warning" />
                <span className="font-semibold tabular-nums text-ink">{progress.streakDays}</span>
                {progress.streakDays === 1 ? 'day' : 'days'}
              </span>
            </div>
          </div>
          <Link href="/projects" title={!wide ? 'All projects' : undefined} className={cn('mt-2 flex h-9 items-center gap-2 rounded-xl px-3 text-[13px] font-medium text-muted hover:bg-surface-2 hover:text-ink', !wide && 'lg:justify-center lg:px-0', focus)}>
            <Icon name="book" className="h-4 w-4 shrink-0" />
            <span className={cn(!wide && 'lg:sr-only')}>All projects</span>
          </Link>
          <Link href="/#start" title={!wide ? 'Learn another repo' : undefined} className={cn('flex h-9 items-center gap-2 rounded-xl px-3 text-[13px] font-medium text-muted hover:bg-surface-2 hover:text-ink', !wide && 'lg:justify-center lg:px-0', focus)}>
            <Icon name="github" className="h-4 w-4 shrink-0" />
            <span className={cn(!wide && 'lg:sr-only')}>Learn another repo</span>
          </Link>
        </div>
      </nav>
    </>
  );
}

/** On phones: the brand, the project and a menu button, since the sidebar is tucked away. */
function MobileBar({ name, onMenu }: { name: string; onMenu: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface/85 px-3 backdrop-blur-md lg:hidden">
      <button type="button" onClick={onMenu} aria-label="Open menu" className={cn('grid h-10 w-10 place-items-center rounded-xl text-ink hover:bg-surface-2', focus)}>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h10" />
        </svg>
      </button>
      <Brand compact />
      <span className="min-w-0 truncate text-[14px] font-medium text-muted">{name.replace(/^.*\//, '')}</span>
    </header>
  );
}

function ShellWithBundle({ bundle, children }: { bundle: RepoBundle; children: ReactNode }) {
  const { progress, loaded, dispatch } = useProgress(bundle.id, bundle.plan);
  const base = `/r/${bundle.id}`;
  const pathname = usePathname();
  const { qaState: qa, ...status } = useProjectStatus(bundle, progress, pathname);
  const flowsBroken = useMemo(() => flowCounts(flowViews(bundle.features, qa.report).values()).failed, [bundle.features, qa.report]);
  // Remember this project and where it stands, for the Projects list. `record` stands for status
  // and loaded, so it saves when they change, not on every render.
  const record = JSON.stringify({ status, loaded });
  useEffect(() => {
    if (!loaded) return;
    projectStore.save({ id: bundle.id, name: bundle.name, source: bundle.source, framework: bundle.framework.label, lastOpened: new Date().toISOString(), ...status });
  }, [bundle, record]);
  const [concept, setConcept] = useState<ConceptId | undefined>();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(NAV_KEY) === '1');
    } catch {
      // The sidebar starts open when storage is blocked.
    }
  }, []);
  const collapse = () =>
    setCollapsed((now) => {
      try {
        window.localStorage.setItem(NAV_KEY, now ? '0' : '1');
      } catch {
        // Remembering the fold is only a convenience.
      }
      return !now;
    });
  const closeDrawer = useCallback(() => setDrawer(false), []);
  const openConcept = useCallback(
    (id: ConceptId) => {
      setConcept(id);
      dispatch({ type: 'concept.viewed', conceptId: id });
    },
    [dispatch],
  );
  return (
    <RepoContext.Provider value={{ bundle, progress, progressLoaded: loaded, dispatch, base, openConcept, status, qa }}>
      <Sidebar bundle={bundle} base={base} progress={progress} status={status} flowsBroken={flowsBroken} collapsed={collapsed} onCollapse={collapse} open={drawer} onClose={closeDrawer} />
      <MobileBar name={bundle.name} onMenu={() => setDrawer(true)} />
      <main id="main" className={cn('min-h-screen pb-24 transition-[padding] duration-300 lg:pb-12', collapsed ? 'lg:pl-[76px]' : 'lg:pl-[264px]')}>
        <div className="mx-auto max-w-[1720px] px-4 pt-6 sm:px-6 lg:px-10 lg:pt-10">{children}</div>
      </main>
      <ConceptDrawer bundle={bundle} base={base} conceptId={concept} onClose={() => setConcept(undefined)} />
    </RepoContext.Provider>
  );
}

/** Loads a repository's lessons and local progress, then shows the page inside the repo's sidebar. */
export function RepoShell({ repo, children }: { repo: string; children: ReactNode }) {
  const state = useBundle(repo);
  if (state.status === 'loading')
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center" role="status">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-accent-soft border-t-accent" aria-hidden="true" />
        <p className="mt-4 text-muted">Getting your lessons ready…</p>
      </div>
    );
  const local = repo.startsWith('local-');
  if (local && state.status !== 'ready')
    return (
      <PageMessage title="Your app’s lessons aren’t available right now">
        <p>They are served by CodeDNA on your computer. If you stopped it, run it again in your project folder and use the new link it prints.</p>
      </PageMessage>
    );
  if (repo.startsWith('gh-') && state.status === 'missing')
    return (
      <PageMessage title="This repo isn’t loaded here anymore">
        <p>Imported repos are kept for a while, then cleared. Import it again from the start page — it only takes a moment.</p>
        <ButtonLink href="/#start" className="mt-6">
          Import a repo
        </ButtonLink>
      </PageMessage>
    );
  if (state.status === 'missing')
    return (
      <PageMessage title="We couldn’t find that app">
        <p>It may have been a starter repo that moved, or the link has a typo.</p>
        <ButtonLink href="/explore" className="mt-6">
          See starter repos
        </ButtonLink>
      </PageMessage>
    );
  if (state.status === 'error')
    return (
      <PageMessage title="Something went wrong">
        <p>{state.message}</p>
      </PageMessage>
    );
  return <ShellWithBundle bundle={state.value}>{children}</ShellWithBundle>;
}
