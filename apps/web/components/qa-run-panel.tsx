'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@codedna/learn-ui';
import { QA_OWNER_LINE, QA_OWNER_PATH, qaTargetOf, qaTotals, qaWorkflowYaml, type QaLiveRun, type QaMode, type QaTarget } from '@codedna/shared';
import { tokenLink, useGithubQa, type GithubQaState } from '@/lib/github-qa';
import { saveAppUrl, savedAppUrl, type LiveQa } from '@/lib/qa-live';
import { cn } from '@/lib/utils';
import { Command } from './qa-results';
import { useRepo } from './repo-shell';
import { Card, focus } from './ui';

const button = (tone: 'primary' | 'secondary' | 'danger') =>
  cn(
    'inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl px-4 text-[14px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    tone === 'primary' && 'bg-accent text-on-accent shadow-card hover:bg-accent/90',
    tone === 'secondary' && 'border border-line bg-surface text-ink hover:border-accent/50',
    tone === 'danger' && 'border border-danger/40 bg-danger-soft text-danger hover:border-danger',
    focus,
  );
const label = 'text-[12px] font-semibold uppercase tracking-wider text-muted';

/** What the page needs to start a run: the app's address and how far to go. */
export interface RunSettings {
  url: string;
  setUrl: (url: string) => void;
  target: QaTarget;
  mode: QaMode;
  setMode: (mode: QaMode) => void;
}

export function useRunSettings(): RunSettings {
  const { bundle } = useRepo();
  const [url, setUrlState] = useState('http://localhost:3000');
  const [mode, setMode] = useState<QaMode>('look');
  useEffect(() => {
    const saved = savedAppUrl(bundle.id);
    if (saved) setUrlState(saved);
  }, [bundle.id]);
  return {
    url,
    setUrl: (next) => {
      setUrlState(next);
      saveAppUrl(bundle.id, next);
    },
    target: qaTargetOf(url),
    mode,
    setMode,
  };
}

/** Asked before a full run: it sends test data to the app. A real modal, so focus stays in it. */
export function ConfirmSend({ open, url, deployed, onCancel, onConfirm }: { open: boolean; url: string; deployed: boolean; onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal?.();
    if (!open && element.open) element.close();
  }, [open]);
  return (
    <dialog ref={dialog} aria-labelledby={titleId} onCancel={onCancel} className="w-[min(92vw,520px)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-lift backdrop:bg-black/40">
      <div className="p-6">
        <h2 id={titleId} className="flex items-center gap-2 text-[18px] font-semibold">
          <Icon name="logic" className="h-5 w-5 text-warning" /> Send test data to {url}?
        </h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed text-muted">
          <li>Forms are filled in and sent: properly, empty, with wrong formats, very long text, emoji, and pressed twice. That can add records to the app.</li>
          <li>Only made-up test data is typed — never real names, emails or cards.</li>
          <li>Deleting, paying, transferring and signing out are always skipped.</li>
          <li>{deployed ? 'This is a deployed site: use a test or preview copy, never the live one your users rely on.' : 'Use a test copy of your app with a test database.'}</li>
        </ul>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" className={button('secondary')} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={button('primary')} onClick={onConfirm}>
            Yes, send test data
          </button>
        </div>
      </div>
    </dialog>
  );
}

function ModeChoice({ settings }: { settings: RunSettings }) {
  const name = useId();
  const options: [QaMode, string, string][] = [
    ['look', 'Look only', 'Opens every flow’s page, finds its button and follows links. Sends nothing.'],
    ['full', 'Full test', 'Also fills in forms with test data and presses their buttons, case by case.'],
  ];
  return (
    <fieldset>
      <legend className={label}>How far to go</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {options.map(([value, title, text]) => (
          <label key={value} className={cn('flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors', settings.mode === value ? 'border-accent bg-accent-soft/50' : 'border-line bg-surface hover:border-accent/40')}>
            <input type="radio" name={name} value={value} checked={settings.mode === value} onChange={() => settings.setMode(value)} className="mt-1 accent-[rgb(var(--color-accent))]" />
            <span>
              <span className="block text-[14px] font-medium text-ink">{title}</span>
              <span className="block text-[12.5px] leading-snug text-muted">{text}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function AddressField({ settings, hint }: { settings: RunSettings; hint?: ReactNode }) {
  const id = useId();
  const problem = 'problem' in settings.target ? settings.target.problem : undefined;
  return (
    <div>
      <label htmlFor={id} className={label}>
        Your app’s address
      </label>
      <input
        id={id}
        type="url"
        inputMode="url"
        spellCheck={false}
        value={settings.url}
        onChange={(event) => settings.setUrl(event.target.value)}
        placeholder="http://localhost:3000 or https://my-app.vercel.app"
        aria-invalid={problem ? true : undefined}
        aria-describedby={`${id}-hint`}
        className={cn('mt-2 h-11 w-full rounded-xl border bg-surface px-3 font-mono text-[14px] text-ink placeholder:text-muted/70', problem ? 'border-danger' : 'border-line', focus)}
      />
      <p id={`${id}-hint`} className={cn('mt-1.5 text-[12.5px]', problem ? 'text-danger' : 'text-muted')}>
        {problem ?? hint}
      </p>
    </div>
  );
}

/** What to set up so a deployed site agrees to a full test. */
function OwnerFile({ origin }: { origin?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/50 p-3.5 text-[13px] leading-relaxed text-muted">
      <p>
        A full test of a deployed site needs its owner’s agreement. Publish <code className="font-mono text-ink">{`${origin ?? ''}${QA_OWNER_PATH}`}</code> with this line (in Next.js, save it as <code className="font-mono text-ink">{`public${QA_OWNER_PATH}`}</code>):
      </p>
      <div className="mt-2">
        <Command text={QA_OWNER_LINE} />
      </div>
      <p className="mt-2">Only on a test or preview copy. Without it, CodeDNA only looks.</p>
    </div>
  );
}

function CiSetup() {
  const yaml = qaWorkflowYaml();
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3 text-[13px] leading-relaxed text-muted">
      <p>Let GitHub test every flow of your site by itself: after each successful deploy (with a comment on the pull request), every night, and whenever you press Run. It runs on GitHub’s machines for your repo, not on CodeDNA’s.</p>
      <p>In your project folder:</p>
      <Command text="codedna ci" />
      <p>then commit and push the new workflow. In the repo’s Settings → Secrets and variables → Actions, you can add:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <code className="font-mono text-ink">CODEDNA_QA_URL</code> (variable): the site to test every night.
        </li>
        <li>
          <code className="font-mono text-ink">CODEDNA_QA_INTERACT</code> = <code className="font-mono text-ink">true</code> (variable): a full test, once the site has the ownership file.
        </li>
        <li>
          <code className="font-mono text-ink">VERCEL_AUTOMATION_BYPASS_SECRET</code> (secret): for Vercel previews behind Vercel Authentication.
        </li>
        <li>
          <code className="font-mono text-ink">CODEDNA_QA_EMAIL</code> and <code className="font-mono text-ink">CODEDNA_QA_PASSWORD</code> (secrets): a test account, so journeys can sign in.
        </li>
      </ul>
      <p>Each run keeps a <span className="font-medium text-ink">codedna-qa</span> download with the report and screenshots. Load its qa-report.json on this page to see every step.</p>
      <details>
        <summary className={cn('cursor-pointer font-medium text-accent', focus)}>Or copy the workflow file</summary>
        <div className="mt-2 flex items-center justify-between gap-2">
          <code className="font-mono text-[12px] text-ink">.github/workflows/codedna-qa.yml</code>
          <button
            type="button"
            className={cn(button('secondary'), 'min-h-[32px] px-3 text-[12.5px]')}
            onClick={() =>
              void navigator.clipboard?.writeText(yaml).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            <span aria-live="polite">{copied ? 'Copied' : 'Copy file'}</span>
          </button>
        </div>
        <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-line bg-code p-3 font-mono text-[11.5px] leading-5 text-ink" tabIndex={0}>
          {yaml}
        </pre>
      </details>
    </div>
  );
}

function LoadReport() {
  const { qa } = useRepo();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string>();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={button('secondary')} onClick={() => input.current?.click()}>
        <Icon name="book" className="h-4 w-4" /> Load a report
      </button>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        tabIndex={-1}
        aria-label="QA report file"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) setProblem(await qa.loadFile(file));
        }}
      />
      <span className={cn('text-[12.5px]', problem ? 'text-danger' : 'text-muted')} role={problem ? 'alert' : undefined}>
        {problem ?? 'qa-report.json, from your project’s .codedna folder or a CI run.'}
      </span>
    </div>
  );
}

/** The fallback to Connect GitHub: a fine-grained token for this repo, pasted by hand. */
function TokenForm({ repo, gh }: { repo: string; gh: GithubQaState }) {
  const tokenId = useId();
  const [token, setToken] = useState('');
  const [remember, setRemember] = useState(false);
  return (
    <form
      className="mt-3 space-y-3 text-[13px] leading-relaxed text-muted"
      onSubmit={(event) => {
        event.preventDefault();
        void gh.connect(token, remember).then(() => setToken(''));
      }}
    >
      <ol className="list-decimal space-y-1 pl-5">
        <li>
          <a href={tokenLink(repo)} target="_blank" rel="noreferrer" className={cn('font-medium text-accent hover:underline', focus)}>
            Make a fine-grained token ↗
          </a>{' '}
          {`for ${repo} only, with the permission “Actions: Read and write”. (For an organisation’s repo, an owner may need to approve it.)`}
        </li>
        <li>Paste it here. It stays in this browser and goes only to GitHub — and to CodeDNA once per run, to fetch the results zip, which GitHub doesn’t let browsers download.</li>
      </ol>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1">
          <label htmlFor={tokenId} className={label}>
            GitHub token
          </label>
          <input id={tokenId} type="password" autoComplete="off" spellCheck={false} value={token} onChange={(event) => setToken(event.target.value)} placeholder="github_pat_…" className={cn('mt-2 h-10 w-full rounded-xl border border-line bg-surface px-3 font-mono text-[13px] text-ink', focus)} />
        </div>
        <button type="submit" className={button('secondary')} disabled={!token.trim()}>
          Connect
        </button>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="accent-[rgb(var(--color-accent))]" />
        Remember it on this browser (otherwise it’s forgotten when you close the tab)
      </label>
    </form>
  );
}

/** The hosted page's Test button: runs the repo's CodeDNA QA workflow on GitHub Actions. */
function GithubRunner({ repo, gh, settings, onRun, label: runLabel }: { repo: string; gh: GithubQaState; settings: RunSettings; onRun: () => void; label: string }) {
  const { qa } = useRepo();
  const [app, setApp] = useState<{ enabled: boolean; installUrl?: string }>();
  useEffect(() => {
    let active = true;
    void fetch('/api/github/auth/config', { cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<{ enabled: boolean; installUrl?: string }>) : { enabled: false }))
      .catch(() => ({ enabled: false }))
      .then((value) => {
        if (active) setApp(value);
      });
    return () => {
      active = false;
    };
  }, []);
  const connectHref = () => `/api/github/auth/start?return=${encodeURIComponent(window.location.pathname)}`;
  const busy = gh.phase === 'starting' || gh.phase === 'queued' || gh.phase === 'running' || gh.phase === 'fetching';
  const canRun = (gh.phase === 'ready' || gh.phase === 'done') && !('problem' in settings.target);
  const totals = gh.phase === 'done' && qa.report ? qaTotals(qa.report) : undefined;
  const status: Partial<Record<GithubQaState['phase'], string>> = {
    disconnected: 'Connect GitHub first (below).',
    checking: 'Checking GitHub…',
    missing: 'Add the workflow first (below).',
    starting: 'Starting the run on GitHub…',
    queued: 'Waiting for a GitHub machine…',
    running: 'Testing every flow on GitHub. This takes a few minutes; you can keep this page open or come back.',
    fetching: 'Getting the results…',
    done: totals ? `Finished: ${totals.failed} broke, ${totals.warning} to look at, ${totals.passed} passed. The results are below.` : 'Finished. The results are below.',
  };
  return (
    <div className="rounded-xl border border-line bg-surface-2/40 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={button('primary')} disabled={!canRun} onClick={onRun}>
          <Icon name="play" className="h-4 w-4" /> {busy ? 'Testing on GitHub…' : runLabel}
        </button>
        <p className="min-w-0 flex-1 text-[13px] text-muted" role="status" aria-live="polite">
          {status[gh.phase] ?? ''}
          {gh.runUrl ? (
            <>
              {' '}
              <a href={gh.runUrl} target="_blank" rel="noreferrer" className={cn('font-medium text-accent hover:underline', focus)}>
                Open the run on GitHub ↗
              </a>
            </>
          ) : null}
        </p>
      </div>
      <p className="mt-2 text-[12.5px] text-muted">{`Runs ${repo}’s CodeDNA QA workflow on GitHub’s machines, then shows every step here.`}</p>
      {gh.error ? (
        <p className="mt-3 rounded-xl border border-danger/40 bg-danger-soft/40 p-3 text-[13px] leading-relaxed text-danger" role="alert">
          {gh.error}
        </p>
      ) : null}

      {gh.phase === 'disconnected' && app?.enabled ? (
        <div className="mt-4 space-y-3 border-t border-line pt-4 text-[13px] leading-relaxed text-muted">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={button('secondary')} onClick={() => window.location.assign(connectHref())}>
              <Icon name="github" className="h-4 w-4" /> Connect GitHub
            </button>
            <span>You approve CodeDNA on GitHub and come straight back. It can only start and read the CodeDNA QA workflow, on repos where its app is installed.</span>
          </div>
          {app.installUrl ? (
            <p>
              {`First time on ${repo}? `}
              <a href={app.installUrl} target="_blank" rel="noreferrer" className={cn('font-medium text-accent hover:underline', focus)}>
                Install the CodeDNA app on it ↗
              </a>{' '}
              (for an organisation’s repo, an owner may need to).
            </p>
          ) : null}
          <details>
            <summary className={cn('cursor-pointer font-medium text-accent', focus)}>Or paste a token instead</summary>
            <TokenForm repo={repo} gh={gh} />
          </details>
        </div>
      ) : gh.phase === 'disconnected' ? (
        <div className="mt-4 border-t border-line pt-4">
          <TokenForm repo={repo} gh={gh} />
        </div>
      ) : gh.phase === 'failed' && gh.via === 'app' && app?.installUrl ? (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
          <a href={app.installUrl} target="_blank" rel="noreferrer" className={cn('font-medium text-accent hover:underline', focus)}>
            Install the CodeDNA app on {repo} ↗
          </a>
          <button type="button" onClick={gh.recheck} className={cn('font-medium text-accent hover:underline', focus)}>
            Check again
          </button>
          <button type="button" onClick={gh.disconnect} className={cn('font-medium text-muted hover:text-ink', focus)}>
            Disconnect GitHub
          </button>
        </div>
      ) : gh.phase === 'missing' ? (
        <div className="mt-4 space-y-3 border-t border-line pt-4 text-[13px] leading-relaxed text-muted">
          <p className="font-medium text-ink">{`${repo} doesn’t have the CodeDNA QA workflow yet`}</p>
          <CiSetup />
          <button type="button" className={button('secondary')} onClick={gh.recheck}>
            Check again
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
          {gh.phase === 'failed' ? (
            <button type="button" onClick={gh.recheck} className={cn('font-medium text-accent hover:underline', focus)}>
              Check again
            </button>
          ) : null}
          <button type="button" onClick={gh.disconnect} className={cn('font-medium text-muted hover:text-ink', focus)}>
            {gh.remembered ? 'Disconnect GitHub (forget the token)' : 'Disconnect GitHub'}
          </button>
        </div>
      )}
    </div>
  );
}

/** The command that tests this repo from a terminal, with the address filled in. */
function commandFor(target: QaTarget, mode: QaMode, github?: string) {
  const url = 'url' in target ? target.url : 'https://my-app.vercel.app';
  return `codedna qa path/to/app --url ${url} --only journeys,flows${mode === 'full' ? ' --interact' : ''}${github ? ` --github ${github}` : ''}`;
}

/**
 * Test runs for the QA flows page. Opened with `codedna`, the page starts runs itself (on this
 * computer). On the hosted site it shows how: on your computer, a deployed site, or every deploy.
 */
export function QaRunPanel({ live, settings, onRun, runLabel = 'Test all flows', nameOf }: { live: LiveQa; settings: RunSettings; onRun: () => void; runLabel?: string; nameOf?: (run: QaLiveRun) => string | undefined }) {
  const { bundle, qa } = useRepo();
  const [tab, setTab] = useState<'computer' | 'deployed' | 'ci'>('deployed');
  const github = !live.available && bundle.source === 'github' ? bundle.name : undefined;
  const gh = useGithubQa(github, (report, shots) => qa.loadReport(report, shots));
  const [asking, setAsking] = useState(false);
  const startOnGithub = () => {
    if ('url' in settings.target) void gh.start({ url: settings.target.url, mode: settings.mode });
  };
  const deployed = 'kind' in settings.target && settings.target.kind === 'deployed';
  const run = live.run;
  const done = run && run.state !== 'idle' && run.state !== 'running' ? run : undefined;
  const titles = new Map(bundle.features.map((feature) => [feature.id, feature.title]));

  if (live.available)
    return (
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-[16px] font-semibold text-ink">
              <Icon name="play" className="h-4 w-4 text-accent" /> Test in a browser
            </h2>
            <p className="mt-0.5 text-[13px] text-muted">Runs on this computer, in a hidden browser. Pick one below to test just that one.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <AddressField settings={settings} hint={deployed ? 'A deployed site: looking is always fine; a full test needs its ownership file.' : 'Start your app first, then test it here.'} />
          <ModeChoice settings={settings} />
        </div>
        {settings.mode === 'full' && deployed ? (
          <div className="mt-4">
            <OwnerFile {...('origin' in settings.target ? { origin: settings.target.origin } : {})} />
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {live.running ? (
            <button type="button" className={button('danger')} onClick={live.stop}>
              Stop
            </button>
          ) : (
            <button type="button" className={button('primary')} disabled={'problem' in settings.target} onClick={() => onRun()}>
              <Icon name="play" className="h-4 w-4" /> {runLabel}
            </button>
          )}
          <p className="min-w-0 flex-1 text-[13px] text-muted" role="status" aria-live="polite">
            {live.running && run
              ? `Testing${run.current ? ` ${nameOf?.(run) ?? (run.current.featureId ? titles.get(run.current.featureId) : undefined) ?? 'a flow'}` : ''}… ${run.checks.length} ${run.kind === 'journeys' ? 'journey' : 'check'}${run.checks.length === 1 ? '' : 's'} done.`
              : done
                ? done.state === 'failed'
                  ? ''
                  : `${done.state === 'stopped' ? 'Stopped' : 'Finished'}: ${done.checks.filter((check) => check.status === 'failed').length} broke, ${done.checks.filter((check) => check.status === 'warning').length} to look at, ${done.checks.filter((check) => check.status === 'passed').length} passed.`
                : null}
          </p>
        </div>
        {done?.state === 'failed' && done.error ? (
          <p className="mt-3 rounded-xl border border-danger/40 bg-danger-soft/40 p-3 text-[13px] text-danger" role="alert">
            {done.error}
          </p>
        ) : null}
        <details className="mt-4">
          <summary className={cn('cursor-pointer text-[13px] font-medium text-accent', focus)}>Test automatically on every deploy</summary>
          <div className="mt-3">
            <CiSetup />
          </div>
        </details>
      </Card>
    );

  const tabs: ['computer' | 'deployed' | 'ci', string][] = [
    ['deployed', 'A deployed site'],
    ['computer', 'On your computer'],
    ['ci', 'Every deploy'],
  ];
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-[16px] font-semibold text-ink">
        <Icon name="play" className="h-4 w-4 text-accent" /> Test in a browser
      </h2>
      <p className="mt-0.5 text-[13px] text-muted">The browser runs on your computer or on GitHub — never on CodeDNA’s servers — then the results show up here.</p>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Where to test">
        {tabs.map(([id, text]) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)} className={cn('h-9 rounded-xl border px-3 text-[13px] font-medium transition-colors', tab === id ? 'border-accent bg-accent-soft text-ink' : 'border-line bg-surface text-muted hover:text-ink', focus)}>
            {text}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {tab === 'deployed' ? (
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <AddressField settings={settings} hint="Your site, e.g. https://my-app.vercel.app." />
              <ModeChoice settings={settings} />
            </div>
            {settings.mode === 'full' ? <OwnerFile {...('origin' in settings.target ? { origin: settings.target.origin } : {})} /> : null}
            {github ? <GithubRunner repo={github} gh={gh} settings={settings} label={runLabel} onRun={() => (settings.mode === 'full' ? setAsking(true) : startOnGithub())} /> : null}
            {github ? (
              <details className="text-[13px] text-muted">
                <summary className={cn('cursor-pointer font-medium text-accent', focus)}>Or run it on your computer</summary>
                <div className="mt-2 space-y-2">
                  <p>In a copy of this repo on your computer, run:</p>
                  <Command text={commandFor(settings.target, settings.mode, github)} />
                  <p>then load the report it saves (.codedna/qa-report.json) here.</p>
                </div>
              </details>
            ) : (
              <div className="space-y-2 text-[13px] text-muted">
                <p>In a copy of this repo on your computer, run:</p>
                <Command text={commandFor(settings.target, settings.mode)} />
                <p>then load the report it saves (.codedna/qa-report.json) here.</p>
              </div>
            )}
            <ConfirmSend
              open={asking}
              url={'url' in settings.target ? settings.target.url : settings.url}
              deployed
              onCancel={() => setAsking(false)}
              onConfirm={() => {
                setAsking(false);
                startOnGithub();
              }}
            />
          </div>
        ) : tab === 'computer' ? (
          <div className="space-y-2 text-[13px] leading-relaxed text-muted">
            <p>Open this project with CodeDNA on your computer, and this page gets a Test button for every flow:</p>
            <Command text="codedna path/to/app" />
            <p className="text-[12px]">
              Not on npm yet: from the CodeDNA folder use <code className="font-mono text-ink">pnpm codedna path/to/app</code>.
            </p>
          </div>
        ) : (
          <CiSetup />
        )}
      </div>
      <div className="mt-5 border-t border-line pt-4">
        <LoadReport />
        {qa.origin === 'file' ? (
          <button type="button" onClick={qa.forget} className={cn('mt-2 text-[12.5px] font-medium text-accent hover:underline', focus)}>
            Forget the loaded report
          </button>
        ) : null}
      </div>
    </Card>
  );
}
