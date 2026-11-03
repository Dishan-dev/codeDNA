import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ActionIndex, RepositorySnapshot, UserAction } from '@codedna/shared';
import { analyzeSnapshot, analyzeUIFlows } from './index.js';
import { discoverFeatures } from './features.js';
import { analyzeActions, humanize } from './actions.js';
import { hydrateTrace, reverseReach, searchIndex, visibleSteps } from './trace-view.js';
import fixture from '../fixtures/next-actions-app.snapshot.json';

const snapshot = fixture as RepositorySnapshot;
const run = (input: RepositorySnapshot, options: Parameters<typeof analyzeActions>[3] = {}) => {
  const result = analyzeSnapshot(input);
  return analyzeActions(input, result, analyzeUIFlows(input).graph, options);
};
const index = run(snapshot);
const action = (label: string, data: ActionIndex = index): UserAction => {
  const found = data.actions.find((item) => item.label === label);
  if (!found) throw new Error(`No action ${label}: ${data.actions.map((item) => item.label).join(', ')}`);
  return found;
};
const steps = (label: string, data: ActionIndex = index) => data.traces.find((trace) => trace.id === action(label, data).traceId)!.steps;
const app = (files: Record<string, string>): RepositorySnapshot => ({ schemaVersion: '1.0', id: 'inline', files: Object.entries(files).map(([path, content]) => ({ id: path, path, content })) });

describe('fixture', () => {
  it('stays in sync with the fixture directory', () => {
    const root = join(__dirname, '..', 'fixtures', 'next-actions-app');
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
    const paths = walk(root).map((path) => relative(root, path).split(sep).join('/')).filter((path) => !/\.md$|package\.json$/.test(path)).sort();
    expect(snapshot.files.map((file) => file.path).sort()).toEqual(paths);
    for (const file of snapshot.files) expect(file.content).toBe(readFileSync(join(root, file.path), 'utf8').replace(/\r\n/g, '\n'));
  });
});

describe('entry-point detection', () => {
  it('groups actions by page route and component, including route handlers', () => {
    expect(index.pages.map((page) => page.route)).toEqual(['/', '/admin', '/book/[roomId]', '/bookings', '/rooms', 'API routes']);
    expect(index.pages.find((page) => page.route === '/')).toMatchObject({ title: 'Roomly', actionCount: 3 });
    expect(index.apiRoutes).toBe(2);
    const book = index.actions.filter((item) => item.pageRoute === '/book/[roomId]');
    expect(book.map((item) => item.component)).toEqual(['BookingForm', 'BookingForm', 'BookingForm', 'BookingForm']);
  });
  it('detects form actions through useActionState, event handlers, inline handlers and links', () => {
    expect(action('Create booking')).toMatchObject({ triggerKind: 'form-action', triggerCode: '<form action={formAction}>', file: 'components/booking-form.tsx' });
    expect(action('Apply promo')).toMatchObject({ triggerKind: 'event-handler', triggerCode: '<button onClick={applyPromo}>' });
    expect(action('Save favorite').triggerCode).toContain('() => toggleFavorite(room.id)');
    expect(action('Browse rooms').triggerKind).toBe('link');
    expect(action('Go to /book/[roomId]').triggerKind).toBe('link');
    expect(action('POST /api/favorites').triggerKind).toBe('route-handler');
  });
  it('attributes forwarded handler props to the defining component only', () => {
    const data = run(app({
      'app/page.tsx': "import { Field } from './field';\nexport default function Page() { return <Field onSave={() => save()} />; }\nfunction save() {}",
      'app/field.tsx': 'export function Field({ onSave }: { onSave: () => void }) { return <button onClick={onSave}>Save</button>; }',
    }));
    expect(data.actions).toHaveLength(1);
    expect(data.actions[0]).toMatchObject({ component: 'Page', triggerCode: '<Field onSave={() => save()}>', worstTier: 'resolved' });
  });
  it('uses stable identifiers for the same snapshot', () => {
    const again = run(snapshot);
    expect(again.actions.map((item) => item.id)).toEqual(index.actions.map((item) => item.id));
    expect(again.traces.flatMap((trace) => trace.steps.map((step) => step.id))).toEqual(index.traces.flatMap((trace) => trace.steps.map((step) => step.id)));
  });
});

describe('effect classification', () => {
  it('recognises zod, cookies, redirect, Prisma writes and revalidatePath', () => {
    expect(action('Create booking').effects.map((effect) => effect.label)).toEqual(['validates BookingSchema', 'reads cookie session', 'redirects /login', 'writes Booking', 'revalidates /bookings', 'redirects /bookings/${…}']);
    expect(action('Create booking').changesData).toBe(true);
  });
  it('recognises fetch, local state setters and navigation', () => {
    expect(action('Apply promo').effects.map((effect) => effect.kind)).toEqual(['http', 'local-state']);
    expect(action('Apply promo').changesData).toBe(false);
    expect(action('Save favorite').effects.map((effect) => effect.label)).toEqual(['POST /api/favorites', 'writes Favorite']);
    expect(action('Browse rooms').effects).toEqual([expect.objectContaining({ kind: 'navigation', label: 'navigates /rooms' })]);
    expect(action('Edit query').effects[0]).toMatchObject({ kind: 'local-state', label: 'updates query' });
  });
  it('recognises router.push and Prisma reads', () => {
    const data = run(app({
      'app/page.tsx': "'use client';\nimport { useRouter } from 'next/navigation';\nimport { prisma } from './db';\nexport default function Page() {\n  const router = useRouter();\n  async function open() { await prisma.room.findMany(); router.push('/rooms'); }\n  return <button onClick={open}>Open</button>;\n}",
      'app/db.ts': "import { PrismaClient } from '@prisma/client';\nexport const prisma = new PrismaClient();",
    }));
    expect(data.actions[0]!.effects.map((effect) => `${effect.kind}:${effect.tier}`)).toEqual(['db-read:conventional', 'navigation:conventional']);
  });
});

describe('tier assignment', () => {
  it('marks resolved calls, framework rules and heuristic route matches distinctly', () => {
    const favorite = steps('Save favorite');
    expect(favorite.map((step) => `${step.title}:${step.tier}`)).toEqual([
      'User clicks “Save favorite”:resolved',
      'Calls toggleFavorite:resolved',
      'Sends POST /api/favorites:conventional',
      'Handled by POST /api/favorites:heuristic',
      'Writes Favorite:conventional',
    ]);
    expect(action('Save favorite').worstTier).toBe('heuristic');
    expect(steps('Create booking')[0]).toMatchObject({ tier: 'conventional', why: expect.stringContaining('server action') });
    expect(action('Browse rooms').worstTier).toBe('conventional');
  });
  it('never assigns the AI tier to a structural step', () => {
    for (const trace of index.traces) for (const step of trace.steps) expect(step.tier).not.toBe('inferred');
  });
  it('summarises coverage by worst tier', () => {
    const total = index.coverage.followed + index.coverage.heuristic + index.coverage.gap;
    expect(total).toBe(index.actions.length);
    expect(index.coverage.gap).toBe(index.actions.filter((item) => item.gapCount > 0).length);
  });
});

describe('gap detection', () => {
  it('dynamic import()', () => {
    expect(steps('Export CSV')[1]).toMatchObject({ kind: 'gap', tier: 'gap', file: 'app/admin/toolbar.tsx', line: 8, possibleTargets: [{ file: 'app/admin/csv.ts' }] });
  });
  it('computed request URL', () => {
    expect(steps('Import bookings')[1]).toMatchObject({ kind: 'gap', gapReason: expect.stringContaining('`endpoint`') });
  });
  it('obj[key]() dispatch lists possible targets', () => {
    const dispatch = steps('Run pricing job').find((step) => step.kind === 'gap')!;
    expect(dispatch.code).toBe('strategies[kind](1)');
    expect(dispatch.possibleTargets?.map((target) => target.name)).toEqual(['quotePrice', 'flatPrice']);
  });
  it('environment-selected implementation', () => {
    const env = steps('Create booking').find((step) => step.kind === 'gap')!;
    expect(env).toMatchObject({ file: 'lib/payments/index.ts', line: 8, gapReason: expect.stringContaining('PAYMENT_GATEWAY') });
    expect(env.possibleTargets?.map((target) => target.file)).toEqual(['lib/payments/stripe.ts', 'lib/payments/mock.ts']);
  });
  it('missing source', () => {
    expect(steps('Search')[1]).toMatchObject({ kind: 'gap', gapReason: expect.stringContaining('@/analytics/client') });
  });
  it('lists every gap with its action, file and line', () => {
    expect(index.gaps.map((item) => `${item.actionLabel}@${item.file}:${item.line}`)).toEqual(expect.arrayContaining(['Export CSV@app/admin/toolbar.tsx:8', 'Create booking@lib/payments/index.ts:8']));
  });
});

describe('branch conditions', () => {
  const trace = steps('Create booking');
  const decisions = trace.filter((step) => step.kind === 'decision');
  it('records the exact condition text and its options', () => {
    expect(decisions.map((step) => step.branch!.condition)).toEqual(['if (!parsed.success)', 'if (!session)']);
    expect(decisions[1]!.branch!.options).toEqual([{ id: 'then', label: "Yes: redirect('/login')" }, { id: 'else', label: 'No: continue' }]);
  });
  it('marks steps after an early exit as reached only on the other branch', () => {
    const session = decisions[1]!.branch!.id;
    const redirectLogin = trace.find((step) => step.title === 'Redirects to /login')!;
    const write = trace.find((step) => step.title === 'Writes Booking')!;
    expect(redirectLogin.when).toContainEqual({ branchId: session, option: 'then' });
    expect(write.when).toContainEqual({ branchId: session, option: 'else' });
    expect(visibleSteps(trace, { [session]: 'then' })).not.toContain(write);
    expect(visibleSteps(trace, { [session]: 'else' })).not.toContain(redirectLogin);
    expect(visibleSteps(trace, {})).toHaveLength(trace.length);
  });
});

describe('reverse reach', () => {
  const quote = index.traces.flatMap((trace) => trace.steps).find((step) => step.symbol?.name === 'quotePrice')!.symbol!;
  it('lists every action that reaches a symbol with its path and weakest tier', () => {
    const features = discoverFeatures(snapshot, analyzeSnapshot(snapshot), analyzeUIFlows(snapshot).graph);
    const reach = reverseReach(index, quote.id, features.relationships, features.symbols)!;
    expect(reach).toMatchObject({ symbol: 'quotePrice', file: 'lib/pricing.ts', line: 3 });
    expect(reach.actions.map((row) => `${row.label}:${row.tier}`)).toEqual(['Create booking:conventional', 'Apply promo:heuristic', 'GET /api/promos/[code]:conventional']);
    expect(reach.actions.find((row) => row.label === 'Apply promo')!.path).toEqual(['onClick', 'GET /api/promos/${…}', 'GET app/api/promos/[code]/route.ts', 'quotePrice']);
    expect(reach.pages).toEqual(['/book/[roomId]', 'API routes']);
  });
  it('reports dispatch callers it cannot resolve', () => {
    const reach = reverseReach(index, quote.id)!;
    expect(reach.unresolvedCallers).toEqual([expect.objectContaining({ file: 'app/admin/toolbar.tsx', code: 'strategies[kind](1)' })]);
  });
});

describe('trace view', () => {
  it('hydrates bounded excerpts and labels the static scope', () => {
    const trace = hydrateTrace(index, action('Create booking').traceId, snapshot.files)!;
    expect(trace.staticOnly).toBe(true);
    expect(trace.limitations[0]).toContain('Nothing was executed');
    const env = trace.steps.find((step) => step.kind === 'gap')!;
    expect(env.excerpt.lines[env.line - env.excerpt.startLine]).toContain('gateways[key]');
    expect(trace.tierCounts.gap).toBe(1);
  });
  it('searches actions, pages and traced functions', () => {
    expect(searchIndex(index, 'promo').map((hit) => hit.label)).toEqual(['Apply promo', 'GET /api/promos/[code]']);
    expect(searchIndex(index, 'quote').map((hit) => hit.kind)).toContain('symbol');
  });
});

describe('bounds', () => {
  it('marks results partial when the step limit truncates a trace', () => {
    const limited = run(snapshot, { maxSteps: 3 });
    expect(limited.partial).toBe(true);
    expect(limited.traces.every((trace) => trace.steps.length <= 3)).toBe(true);
  });
  it('stops at the action limit and the time budget', () => {
    expect(run(snapshot, { maxActions: 2 }).actions).toHaveLength(2);
    let clock = 0;
    const timed = run(snapshot, { timeBudgetMs: 1, now: () => (clock += 5) });
    expect(timed.partial).toBe(true);
    expect(timed.limitations.join(' ')).toContain('Time budget');
  });
  it('marks a partial snapshot partial and reports when no pages exist', () => {
    expect(run(snapshot, { complete: false }).partial).toBe(true);
    const library = run(app({ 'src/index.ts': 'export function add(a: number, b: number) { return a + b; }' }));
    expect(library.pages).toEqual([]);
    expect(library.limitations.join(' ')).toContain('No pages were detected');
  });
  it('humanizes handler names', () => {
    expect(humanize('handleApplyCoupon')).toBe('Apply coupon');
    expect(humanize('createBooking')).toBe('Create booking');
  });
});
