'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Icon, type IconName } from '@codedna/learn-ui';
import { useStarters } from '@/lib/bundle';
import { cn } from '@/lib/utils';
import { Brand, ButtonLink, Card, Logo, focus } from './ui';

const GITHUB_URL = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\/?$/;

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-4 flex items-center gap-2 rounded-xl border border-line bg-code p-1.5 pl-4">
      <span className="select-none font-mono text-sm text-muted" aria-hidden="true">
        $
      </span>
      <code className="flex-1 font-mono text-[15px] text-ink">{command}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
        className={cn('h-10 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink shadow-card hover:border-accent/50', focus)}
      >
        <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
}

type ImportEvent = { stage: 'downloading'; repo: string } | { stage: 'analysing'; files: number } | { stage: 'done'; id: string; cached: boolean } | { stage: 'error'; code: string; message: string };

/** Read the import route's stream of JSON lines, one event at a time. */
async function* readEvents(response: Response): AsyncGenerator<ImportEvent> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) yield JSON.parse(line) as ImportEvent;
    if (done) return;
  }
}

function GithubForm() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'progress'; text: string } | undefined>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!GITHUB_URL.test(url.trim())) {
      setMessage({ kind: 'error', text: 'Paste a public repo link like https://github.com/owner/repo.' });
      return;
    }
    setBusy(true);
    setMessage({ kind: 'progress', text: 'Connecting to GitHub…' });
    try {
      const response = await fetch('/api/github/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim() }) });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => undefined)) as { error?: { message?: string } } | undefined;
        throw new Error(body?.error?.message ?? 'Something went wrong while importing this repo.');
      }
      for await (const update of readEvents(response)) {
        if (update.stage === 'downloading') setMessage({ kind: 'progress', text: `Downloading ${update.repo}… (the code is only read, never run)` });
        else if (update.stage === 'analysing') setMessage({ kind: 'progress', text: `Reading ${update.files} files… Finding features… Building lessons…` });
        else if (update.stage === 'error') throw new Error(update.message);
        else {
          setMessage({ kind: 'progress', text: 'Ready! Opening your lessons…' });
          router.push(`/r/${update.id}`);
          return;
        }
      }
      throw new Error('The import stopped before it finished. Try again.');
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Something went wrong while importing this repo.' });
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-2" noValidate aria-busy={busy}>
      <label htmlFor="github-url" className="sr-only">
        Public GitHub repo
      </label>
      <input
        id="github-url"
        type="url"
        inputMode="url"
        placeholder="https://github.com/owner/repo"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        disabled={busy}
        aria-describedby={message ? 'github-message' : undefined}
        aria-invalid={message?.kind === 'error'}
        className={cn('h-11 w-full rounded-xl border border-line bg-surface px-4 text-[15px] text-ink shadow-card placeholder:text-muted disabled:opacity-60', focus)}
      />
      <button
        type="submit"
        disabled={busy}
        className={cn('inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-[15px] font-medium text-ink shadow-card hover:border-accent/50 disabled:cursor-wait disabled:opacity-70', focus)}
      >
        {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent-soft border-t-accent" aria-hidden="true" /> : null}
        {busy ? 'Importing…' : 'Learn this repo'}
      </button>
      {message ? (
        <p id="github-message" role={message.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${message.kind === 'error' ? 'text-danger' : 'text-muted'}`}>
          {message.text}
        </p>
      ) : (
        <p className="text-[13px] text-muted">Public repos only. The code is downloaded and read, never run.</p>
      )}
      <ImportLimits />
    </form>
  );
}

/** What a GitHub import can and can't do, before anyone pastes a link. Keep in step with the README. */
const IMPORT_LIMITS: { title: string; items: string[] }[] = [
  {
    title: 'What works',
    items: [
      'Full lessons: Next.js apps that use the App Router, in JavaScript or TypeScript.',
      'Other JavaScript or TypeScript projects are read, but may give few or no lessons.',
      'Not read yet: PHP, Python, Ruby, Go, Java and other languages, and Vue or Svelte files.',
    ],
  },
  {
    title: 'What is read',
    items: [
      'Public repos only, at the latest commit on the default branch. Work you haven’t pushed isn’t there.',
      'Only .js, .jsx, .ts and .tsx files, plus package.json, tsconfig and READMEs. Folders like node_modules, dist and build are skipped.',
      'Up to 1,000 code files, 2 MB per file and 50 MB in total. The download and the analysis each have 60 seconds.',
    ],
  },
  {
    title: 'Limits',
    items: [
      'Up to 5 imports every 10 minutes. Importing the same repo again within 10 minutes reuses the first result.',
      'GitHub limits how often this server may ask for code. If it’s reached, try again later.',
      'Repos that hold many separate apps (like course repos) can give repeated or noisy lessons.',
    ],
  },
];

function ImportLimits() {
  return (
    <details className="group rounded-xl border border-line bg-surface-2/50 text-[13px]">
      <summary className={cn('flex min-h-[40px] cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 font-medium text-ink', focus)}>
        What works, and the limits
        <Icon name="next" className="h-4 w-4 text-muted transition-transform group-open:rotate-90" />
      </summary>
      <div className="space-y-3 px-3 pb-3">
        {IMPORT_LIMITS.map((group) => (
          <section key={group.title}>
            <h3 className="font-semibold text-ink">{group.title}</h3>
            <ul className="mt-1 list-disc space-y-1 pl-4 leading-relaxed text-muted">
              {group.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
}

export function StarterList() {
  const starters = useStarters();
  if (starters.status === 'loading') return <p className="text-muted" role="status">Loading starter repos…</p>;
  if (starters.status !== 'ready') return <p className="text-muted">Starter repos are not available right now.</p>;
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {starters.value.map((starter) => (
        <Card as="li" key={starter.id} className="flex flex-col transition-shadow hover:shadow-lift">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent" aria-hidden="true">
              <Icon name="book" className="h-5 w-5" />
            </span>
            <div>
              <h3 className="font-semibold text-ink">{starter.name}</h3>
              <p className="text-[13px] text-muted">{starter.framework}</p>
            </div>
          </div>
          <p className="mt-4 flex-1 text-[15px] leading-relaxed text-ink/90">{starter.sentence}</p>
          <div className="mt-5 flex items-center justify-between gap-3">
            <span className="text-[13px] text-muted">{starter.lessons} lessons</span>
            <ButtonLink href={`/r/${starter.id}`} icon="play">
              Start learning
            </ButtonLink>
          </div>
        </Card>
      ))}
    </ul>
  );
}

/** A decorative, gently animated glimpse of a lesson, so the first screen shows what CodeDNA does. */
function StoryPreview() {
  const nodes: { icon: IconName; label: string; state: 'done' | 'now' | 'next' }[] = [
    { icon: 'form', label: 'You press “Place order”', state: 'done' },
    { icon: 'request', label: 'Sends the data', state: 'done' },
    { icon: 'check', label: 'Checks you’re signed in', state: 'now' },
    { icon: 'database', label: 'Saves the order', state: 'next' },
    { icon: 'screen', label: 'Shows your order', state: 'next' },
  ];
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-[560px] lg:mx-0">
      <div className="absolute -inset-10 -z-10 rounded-[48px] bg-[radial-gradient(closest-side,rgb(var(--color-accent)/0.28),transparent)] blur-2xl" />
      <div className="codedna-float-slow overflow-hidden rounded-3xl border border-line bg-surface/95 shadow-[0_30px_80px_-20px_rgb(var(--color-accent)/0.35)] backdrop-blur">
        <div className="flex items-center gap-2 border-b border-line bg-surface-2/70 px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
          <span className="ml-3 truncate rounded-md bg-surface px-2.5 py-0.5 font-mono text-[11px] text-muted">Lesson · Place order</span>
        </div>
        <div className="h-1 bg-line/60">
          <div className="codedna-grow h-full bg-gradient-to-r from-accent to-[rgb(var(--hue-violet))]" />
        </div>
        <div className="relative flex items-start justify-between px-5 pb-5 pt-6">
          <span className="absolute left-[52px] right-[52px] top-[42px] h-0.5 bg-line" />
          <span className="absolute left-[52px] top-[42px] h-0.5 w-[calc((100%-104px)/2)] bg-accent" />
          {nodes.map((node) => (
            <div key={node.label} className="relative flex w-16 flex-col items-center text-center">
              <span
                className={cn(
                  'relative z-10 grid h-10 w-10 place-items-center rounded-full border-2',
                  node.state === 'now' ? 'border-accent bg-accent text-on-accent' : node.state === 'done' ? 'border-accent bg-surface text-accent' : 'border-line bg-surface text-muted',
                )}
              >
                {node.state === 'now' ? <span className="codedna-ring absolute inset-0 rounded-full" /> : null}
                <Icon name={node.icon} className="h-4 w-4" />
              </span>
              <span className={cn('mt-2 text-[10.5px] leading-tight', node.state === 'now' ? 'font-semibold text-ink' : 'text-muted')}>{node.label}</span>
            </div>
          ))}
        </div>
        <div className="space-y-3 border-t border-line p-5 sm:p-6">
          <p className="text-xs font-medium text-muted">
            <span className="rounded-full bg-accent-soft px-2 py-0.5 font-semibold text-accent">Step 3 of 5</span> · On the server
          </p>
          <p className="text-xl font-semibold tracking-tight text-ink">Checks you’re signed in</p>
          <p className="text-sm leading-relaxed text-ink/80">
            If there’s no session, the server sends you to <code className="rounded-md border border-line bg-surface-2 px-1 font-mono text-[0.85em]">/login</code> and stops.
          </p>
          <div className="rounded-xl border border-line bg-code p-3 font-mono text-[12px] leading-6">
            <p className="text-muted">
              10 <span className="text-ink">const session = await getSession();</span>
            </p>
            <p className="-mx-3 border-l-[3px] border-accent bg-accent-soft px-[9px] text-accent">
              11 <span className="text-ink">if (!session) redirect(&apos;/login&apos;);</span>
            </p>
            <p className="text-muted">
              12 <span className="text-ink">const parsed = OrderSchema.safeParse(…);</span>
            </p>
          </div>
        </div>
      </div>
      {/* Floating cards: what else CodeDNA tells you */}
      <div className="codedna-float absolute -bottom-6 -left-10 hidden items-center gap-2.5 rounded-2xl border border-line bg-surface px-3.5 py-2.5 shadow-lift sm:flex">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-success-soft text-success">
          <Icon name="done" className="h-4 w-4" />
        </span>
        <span className="text-[12px] leading-tight">
          <span className="block font-semibold text-ink">Requirements</span>
          <span className="text-muted">63% built</span>
        </span>
      </div>
      <div className="codedna-float-late absolute -right-10 top-[236px] hidden items-center gap-2.5 rounded-2xl border border-line bg-surface px-3.5 py-2.5 shadow-lift sm:flex">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-warning-soft text-warning">
          <Icon name="branch" className="h-4 w-4" />
        </span>
        <span className="text-[12px] leading-tight">
          <span className="block font-semibold text-ink">Edge case found</span>
          <span className="text-muted">Clicked twice?</span>
        </span>
      </div>
      <div className="codedna-float absolute -top-4 right-10 hidden rounded-full bg-accent px-3 py-1 text-xs font-semibold text-on-accent shadow-lift sm:block">+10 XP</div>
    </div>
  );
}

const LOOP: { icon: IconName; title: string; text: string }[] = [
  { icon: 'play', title: 'Watch', text: 'Data travels from a button to the server, the database and back, one plain sentence per step.' },
  { icon: 'lightbulb', title: 'Understand', text: 'Short cards explain each idea using lines from the real code.' },
  { icon: 'star', title: 'Try', text: 'Predict, order the steps, spot the bug and fill the gap, all built from that code.' },
  { icon: 'done', title: 'Recap', text: 'See what you learned, keep your streak and move on to the next part of the app.' },
];

const FEATURES: { icon: IconName; hue: string; title: string; text: string; wide?: boolean }[] = [
  { icon: 'play', hue: '--hue-violet', title: 'Every feature becomes a lesson', text: 'CodeDNA traces each flow in the code — click, request, check, save, answer — and turns it into an animated story with the real lines beside it.', wide: true },
  { icon: 'branch', hue: '--hue-sky', title: 'A map of the whole app', text: 'Parts, pages and the main flows, so a newcomer sees how it is put together before reading a file.' },
  { icon: 'check', hue: '--hue-emerald', title: 'Requirements coverage', text: 'Drop in an SRS or client brief and see how much is built, what is partly there and what is still missing.' },
  { icon: 'unknown', hue: '--hue-amber', title: 'Quality checks', text: 'Unhandled requests, unchecked sends and real edge cases from the code’s own conditions, as a checklist.' },
  { icon: 'lock', hue: '--hue-rose', title: 'Private by design', text: 'Code is only read, never run. No account, and your progress stays in your browser.' },
];

function SectionHead({ eyebrow, title, text, id }: { eyebrow: string; title: string; text?: string; id: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">{eyebrow}</p>
      <h2 id={id} className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-[40px] sm:leading-[1.1]">
        {title}
      </h2>
      {text ? <p className="mt-4 text-[17px] leading-relaxed text-muted">{text}</p> : null}
    </div>
  );
}

export function StartPage() {
  return (
    <div className="relative overflow-x-clip">
      {/* Backdrop: a soft grid and two glows behind the hero */}
      <div aria-hidden="true" className="codedna-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-[900px]" />
      <div aria-hidden="true" className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[620px] w-[1100px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(var(--color-accent)/0.22),transparent)]" />
      <div aria-hidden="true" className="pointer-events-none absolute right-[-200px] top-[320px] -z-10 h-[480px] w-[480px] rounded-full bg-[radial-gradient(closest-side,rgb(var(--hue-violet)/0.16),transparent)]" />

      <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Brand />
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {[
              ['How it works', '#how'],
              ['Features', '#features'],
              ['Starter repos', '#starters'],
            ].map(([label, href]) => (
              <a key={href} href={href} className={cn('rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface hover:text-ink', focus)}>
                {label}
              </a>
            ))}
          </nav>
          <ButtonLink href="#start" className="h-10 min-h-0 px-4 text-sm">
            Get started
          </ButtonLink>
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="mx-auto grid max-w-7xl items-center gap-14 px-4 pb-20 pt-12 sm:px-6 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:px-8 lg:pb-28">
          <div className="codedna-rise">
            <p className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-surface/80 px-3.5 py-1.5 text-[13px] font-medium text-ink shadow-card backdrop-blur">
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="codedna-ping absolute inline-flex h-full w-full rounded-full bg-accent" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
              </span>
              Learn to code from real apps
            </p>
            <h1 className="mt-6 text-[44px] font-semibold leading-[1.04] tracking-[-0.03em] text-ink sm:text-[64px]">
              Finally understand <span className="text-accent">how your app works.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted sm:text-xl sm:leading-relaxed">
              CodeDNA turns real code — including the app your AI built for you — into short animated stories, hands-on challenges and a clear picture of what’s built.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href="/r/snackshop" icon="play" size="lg" className="h-[52px] px-7 shadow-[0_10px_30px_-10px_rgb(var(--color-accent)/0.7)]">
                Try a sample app
              </ButtonLink>
              <ButtonLink href="#start" variant="secondary" icon="github" size="lg" className="h-[52px] px-7">
                Learn my own app
              </ButtonLink>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
              {['No account needed', 'Code is read, never run', 'Progress stays in your browser'].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <Icon name="done" className="h-4 w-4 text-success" /> {item}
                </li>
              ))}
            </ul>
          </div>
          <StoryPreview />
        </section>

        {/* How it works */}
        <section id="how" aria-labelledby="how-heading" className="scroll-mt-20 border-y border-line/70 bg-surface/60 py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionHead id="how-heading" eyebrow="How it works" title="Four steps for every feature" text="Each lesson follows one real flow through the code, from the first click to what you see at the end." />
            <ol className="relative mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <span aria-hidden="true" className="absolute left-[12%] right-[12%] top-7 hidden h-0.5 bg-gradient-to-r from-accent/10 via-accent/50 to-accent/10 lg:block" />
              {LOOP.map((item, index) => (
                <li key={item.title} className="group relative rounded-2xl border border-line bg-surface p-6 shadow-card transition-all hover:-translate-y-1 hover:border-accent/40 hover:shadow-lift">
                  <span className="relative grid h-14 w-14 place-items-center rounded-2xl bg-accent text-on-accent shadow-[0_8px_24px_-8px_rgb(var(--color-accent)/0.8)]">
                    <Icon name={item.icon} className="h-6 w-6" />
                  </span>
                  <p className="mt-5 font-mono text-xs text-muted">Step 0{index + 1}</p>
                  <h3 className="mt-1 text-lg font-semibold text-ink">{item.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted">{item.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Features */}
        <section id="features" aria-labelledby="features-heading" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
          <SectionHead id="features-heading" eyebrow="What you get" title="Understand it, then check it’s right" text="Start by learning how the app works. When you need more, see how much of the brief is built and where it could break." />
          <ul className="mt-14 grid gap-5 md:grid-cols-3">
            {FEATURES.map((item) => (
              <li
                key={item.title}
                style={{ ['--tone' as string]: `var(${item.hue})` }}
                className={cn('group relative overflow-hidden rounded-3xl border border-line bg-surface p-7 shadow-card transition-all hover:-translate-y-1 hover:shadow-lift', item.wide && 'md:col-span-2')}
              >
                <span aria-hidden="true" className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[radial-gradient(closest-side,rgb(var(--tone)/0.18),transparent)] transition-transform duration-500 group-hover:scale-125" />
                <span className="relative grid h-12 w-12 place-items-center rounded-2xl bg-[rgb(var(--tone)/0.12)] text-[rgb(var(--tone))] ring-1 ring-[rgb(var(--tone)/0.25)]">
                  <Icon name={item.icon} className="h-6 w-6" />
                </span>
                <h3 className="relative mt-5 text-xl font-semibold tracking-tight text-ink">{item.title}</h3>
                <p className="relative mt-2 max-w-xl text-[15px] leading-relaxed text-muted">{item.text}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Start */}
        <section id="start" aria-labelledby="start-heading" className="scroll-mt-20 border-y border-line/70 bg-surface/60 py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionHead id="start-heading" eyebrow="Get started" title="Three ways in" text="Learn your own project, any public GitHub repo, or a ready-made starter." />
            <div className="mt-14 grid gap-5 lg:grid-cols-3">
              <div className="relative rounded-3xl bg-gradient-to-br from-accent via-accent/40 to-[rgb(var(--hue-violet)/0.6)] p-px shadow-lift">
                <div className="h-full rounded-[23px] bg-surface p-6 sm:p-7">
                  <span className="absolute right-6 top-6 rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-on-accent">Recommended</span>
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent">
                    <Icon name="terminal" className="h-6 w-6" />
                  </span>
                  <h3 className="mt-5 text-xl font-semibold text-ink">Learn my app</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted">Run this in your project folder. Your code is read on your computer and never leaves it.</p>
                  <CopyCommand command="npx codedna" />
                  <p className="mt-3 text-[13px] leading-relaxed text-muted">
                    Not on npm yet — from the CodeDNA folder run <code className="font-mono text-ink">pnpm codedna path/to/your-app</code>.
                  </p>
                </div>
              </div>
              <Card className="rounded-3xl sm:p-7">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-ink">
                  <Icon name="github" className="h-6 w-6" />
                </span>
                <h3 className="mt-5 text-xl font-semibold text-ink">Learn from a GitHub repo</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">Paste a public repository and learn from real, working code.</p>
                <GithubForm />
              </Card>
              <Card className="flex flex-col rounded-3xl sm:p-7">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-ink">
                  <Icon name="book" className="h-6 w-6" />
                </span>
                <h3 className="mt-5 text-xl font-semibold text-ink">Pick a starter repo</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">Small, real apps with lessons ready to go. The fastest way to see how CodeDNA works.</p>
                <ButtonLink href="/explore" variant="secondary" className="mt-5 self-start">
                  Browse starter repos
                </ButtonLink>
              </Card>
            </div>
          </div>
        </section>

        {/* Starters */}
        <section id="starters" aria-labelledby="starters-heading" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
          <SectionHead id="starters-heading" eyebrow="Explore" title="Starter repos" text="Real apps with lessons ready to go." />
          <div className="mt-12">
            <StarterList />
          </div>
        </section>

        {/* Closing call to action */}
        <section aria-labelledby="cta-heading" className="mx-auto max-w-7xl px-4 pb-24 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-[32px] border border-line bg-surface px-6 py-14 text-center shadow-lift sm:px-12 sm:py-16">
            <div aria-hidden="true" className="codedna-grid absolute inset-0 opacity-70" />
            <div aria-hidden="true" className="absolute left-1/2 top-0 h-72 w-[720px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(var(--color-accent)/0.25),transparent)]" />
            <h2 id="cta-heading" className="relative text-3xl font-semibold tracking-tight text-ink sm:text-[40px]">
              See your app from the inside.
            </h2>
            <p className="relative mx-auto mt-4 max-w-xl text-[17px] leading-relaxed text-muted">Five minutes with a sample app shows you everything CodeDNA can do.</p>
            <div className="relative mt-8 flex flex-wrap justify-center gap-3">
              <ButtonLink href="/r/snackshop" icon="play" size="lg" className="h-[52px] px-7">
                Try a sample app
              </ButtonLink>
              <ButtonLink href="#start" variant="secondary" size="lg" className="h-[52px] px-7">
                Learn my own app
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-8 text-sm text-muted sm:px-6 lg:px-8">
          <span className="flex items-center gap-2.5">
            <Logo className="h-6 w-6 rounded-lg" /> CodeDNA — learn from real code.
          </span>
          <span>No account. Progress stays in your browser.</span>
        </div>
      </footer>
    </div>
  );
}
