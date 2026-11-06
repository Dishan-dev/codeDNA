import { describe, expect, it } from 'vitest';
import type { Feature, RepoAnalysis } from '@codedna/shared';
import { loadFixture } from '../../fixtures/load.js';
import { analyzeRepository } from '../analyze.js';

const shop = analyzeRepository(loadFixture('shop-app'));
const feature = (analysis: RepoAnalysis, title: string): Feature => {
  const found = analysis.features.find((item) => item.title === title);
  if (!found) throw new Error(`No feature "${title}" in ${analysis.features.map((item) => item.title).join(', ')}`);
  return found;
};
/** depth-indented "stage: title" lines, the shape a reviewer can check by eye. */
const outline = (item: Feature) => item.steps.map((step) => `${'  '.repeat(step.depth)}${step.stage}: ${step.title}`);

const snap = (files: Record<string, string>, manifests: Record<string, string> = {}) => ({
  schemaVersion: '1.0',
  id: 'demo',
  files: Object.entries(files).map(([path, content]) => ({ id: path, path, content })),
  manifests: Object.entries(manifests).map(([path, content]) => ({ path, content })),
});
const TSCONFIG = { 'tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./*"] } } }' };

describe('Snackshop fixture', () => {
  it('finds every user-facing feature with its page', () => {
    expect(shop.partial).toBe(false);
    expect(shop.features.map((item) => [item.title, item.entryKind, item.page])).toEqual([
      ['Open “Go to checkout”', 'link', '/'],
      ['Export orders', 'event-handler', '/orders'],
      ['Save to favorites', 'event-handler', '/'],
      ['Place order', 'form-action', '/checkout'],
      ['Type in “Coupon code”', 'event-handler', '/checkout'],
      ['Apply coupon', 'event-handler', '/checkout'],
      ['Type in “Search snacks”', 'event-handler', '/'],
    ]);
  });

  it('follows "Place order" from the form, through the server action, to the database and back', () => {
    expect(outline(feature(shop, 'Place order'))).toEqual([
      'form: You press “Place order”',
      '  request: Sends the data to the server',
      '    server: The server runs placeOrder',
      '    logic: Runs getSession',
      '      check: Reads the session cookie',
      '      check: Checks !token',
      '      logic: Stops early and gives back null',
      '      database: Reads session from the database',
      '    check: Checks !session',
      '    screen: Sends you to /login',
      '    check: Checks the data with OrderSchema',
      '    check: Checks !parsed.success',
      '    response: Sends back an answer',
      '    database: Saves a new order',
      '    logic: Runs notify',
      '      server: Picks a function while the app runs',
      '    response: Refreshes /orders',
      '    screen: Sends you to /orders/${…}',
    ]);
  });

  it('records branches with their exact condition and where each answer leads', () => {
    const order = feature(shop, 'Place order');
    const title = (id?: string) => order.steps.find((step) => step.id === id)?.title;
    expect(order.branches.map((branch) => [branch.condition, ...branch.outcomes.map((outcome) => `${outcome.label} → ${title(outcome.nextStepId)}`)])).toEqual([
      ['if (!token)', 'Yes → Stops early and gives back null', 'No → Reads session from the database'],
      ['if (!session)', 'Yes → Sends you to /login', 'No → Checks the data with OrderSchema'],
      ['if (!parsed.success)', 'Yes → Sends back an answer', 'No → Saves a new order'],
    ]);
    // Steps after an early exit are only reached on the other answer.
    const save = order.steps.find((step) => step.title === 'Saves a new order')!;
    expect(save.when?.map((item) => item.outcomeId.split(':').pop())).toEqual(['no', 'no']);
  });

  it('classifies effects with their confidence', () => {
    expect(feature(shop, 'Place order').effects.map((effect) => [effect.kind, effect.label, effect.confidence])).toEqual([
      ['cookie', 'reads cookie session', 'conventional'],
      ['db-read', 'reads session', 'conventional'],
      ['redirect', 'redirects to /login', 'conventional'],
      ['validation', 'validates with OrderSchema', 'conventional'],
      ['db-write', 'writes order', 'conventional'],
      ['revalidate', 'refreshes /orders', 'conventional'],
      ['redirect', 'redirects to /orders/${…}', 'conventional'],
    ]);
  });

  it('follows a fetch into the API route that answers it', () => {
    expect(outline(feature(shop, 'Apply coupon'))).toEqual([
      'click: You click “Apply coupon”',
      '  client: Runs applyCoupon',
      '    request: Sends a POST request to /api/coupons',
      '      server: The server answers POST /api/coupons',
      '      database: Reads coupon from the database',
      '      check: Checks !coupon',
      '      response: Sends back an answer',
      '      response: Sends back an answer',
      '    screen: Updates discount on the screen',
    ]);
  });

  it('marks unknown parts with friendly reasons instead of skipping them', () => {
    const exportGap = feature(shop, 'Export orders').steps.find((step) => step.confidence === 'gap')!;
    expect(exportGap.unknownReason).toMatch(/import\(\)/);
    expect(exportGap.unknownReason).toContain('`@/lib/csv`');
    const notifyGap = feature(shop, 'Place order').steps.find((step) => step.confidence === 'gap')!;
    expect(notifyGap.unknownReason).toBe(
      'Which function runs here is picked by the setting `NOTIFY_CHANNEL`, so it can differ between your computer and the live app. It could be `sendEmail` or `sendSms`.',
    );
  });

  it('shows the data change behind a button with no sign-in check', () => {
    const favorite = feature(shop, 'Save to favorites');
    expect(outline(favorite)).toEqual([
      'click: You click “Save to favorites”',
      '  request: Sends the data to the server',
      '    server: The server runs toggleFavorite',
      '    database: Saves a new favorite',
      '    response: Refreshes /',
    ]);
    expect(favorite.steps.some((step) => step.stage === 'check')).toBe(false);
  });

  it('attaches real code to every step', () => {
    const save = feature(shop, 'Place order').steps.find((step) => step.title === 'Saves a new order')!;
    expect(save.code).toMatchObject({ path: 'app/actions/orders.ts', highlightLine: 18 });
    expect(save.code.excerpt).toContain('prisma.order.create');
    for (const item of shop.features) for (const step of item.steps) expect(step.code.excerpt, step.title).toBeTruthy();
  });

  it('orders difficulty by how much happens', () => {
    expect(feature(shop, 'Type in “Search snacks”').difficulty).toBe(1);
    expect(feature(shop, 'Apply coupon').difficulty).toBe(2);
    expect(feature(shop, 'Place order').difficulty).toBe(3);
  });

  it('keeps ids stable for a commit and keys stable when lines move', () => {
    expect(analyzeRepository(loadFixture('shop-app')).features).toEqual(shop.features);
    const shifted = loadFixture('shop-app');
    const file = shifted.files.find((item) => item.path === 'app/actions/orders.ts')!;
    file.content = file.content.replace("'use server';", "'use server';\n// a new comment moves every line down");
    const moved = feature(analyzeRepository(shifted), 'Place order');
    const original = feature(shop, 'Place order');
    expect(moved.key).toBe(original.key);
    expect(moved.contentHash).toBe(original.contentHash);
    expect(moved.id).toBe(original.id);
  });

  it('changes the content hash when the feature changes', () => {
    const changed = loadFixture('shop-app');
    const file = changed.files.find((item) => item.path === 'app/actions/orders.ts')!;
    file.content = file.content.replace("revalidatePath('/orders');", '');
    expect(feature(analyzeRepository(changed), 'Place order').contentHash).not.toBe(feature(shop, 'Place order').contentHash);
  });
});

describe('call resolution', () => {
  it('follows re-exports, namespace imports, aliases and object methods', () => {
    const result = analyzeRepository(
      snap({
        ...TSCONFIG,
        'lib/save.ts': "import { db } from './db';\nexport async function save() { await db.item.create({ data: {} }); }",
        'lib/db.ts': "import { PrismaClient } from '@prisma/client';\nexport const db = new PrismaClient();",
        'lib/index.ts': "export { save as persist } from './save';\nexport * from './tools';",
        'lib/tools.ts': 'export const tools = { tidy() { return 1; } };\nexport function track() {}',
        'components/a.tsx':
          "'use client';\nimport * as lib from '@/lib';\nimport { persist } from '@/lib';\nconst alias = lib.track;\nexport function A() {\n  return <button onClick={async () => { await persist(); lib.tools.tidy(); alias(); }}>Go</button>;\n}",
      }),
    );
    expect(outline(result.features[0]!)).toEqual(['click: You click “Go”', '  client: Runs persist', '    database: Saves a new item', '  client: Runs tidy', '  client: Runs alias']);
  });

  it('turns a prop callback and several possible implementations into unknown steps', () => {
    const result = analyzeRepository(
      snap({
        'a.tsx': [
          "'use client';",
          'const stripe = { charge: (n: number) => n };',
          "const mock = { charge: (n: number) => 'mock', mock: true };",
          'function pick(flag: boolean) { return flag ? stripe : mock; }',
          'export function Pay({ onDone, flag }: { onDone: () => void; flag: boolean }) {',
          '  return <button onClick={() => { pick(flag).charge(1); onDone(); }}>Pay</button>;',
          '}',
        ].join('\n'),
      }),
    );
    const steps = result.features[0]!.steps;
    expect(steps.map((step) => [step.title, step.confidence])).toEqual([
      ['You click “Pay”', 'conventional'],
      ['Runs pick', 'resolved'],
      ['Runs one of 2 versions', 'gap'],
      ['Runs onDone, passed in from outside', 'gap'],
    ]);
  });

  it('is only fairly sure about a method called on a computed value', () => {
    // Same-shaped objects are merged by TypeScript, so the checker names only one of them.
    const result = analyzeRepository(
      snap({
        'a.tsx': [
          "'use client';",
          'const stripe = { charge: (n: number) => n };',
          'const mock = { charge: (n: number) => 0 };',
          'function pick(flag: boolean) { return flag ? stripe : mock; }',
          'export function Pay({ flag }: { flag: boolean }) {',
          '  return <button onClick={() => { pick(flag).charge(1); stripe.charge(2); }}>Pay</button>;',
          '}',
        ].join('\n'),
      }),
    );
    expect(result.features[0]!.steps.map((step) => [step.title, step.confidence])).toEqual([
      ['You click “Pay”', 'conventional'],
      ['Runs pick', 'resolved'],
      ['Runs charge', 'heuristic'],
      ['Runs charge', 'resolved'],
    ]);
  });

  it('gives the click to the component that defines the handler, not the one that forwards it', () => {
    const result = analyzeRepository(
      snap({
        'button.tsx': "'use client';\nexport function Button({ onClick, children }) { return <button onClick={onClick}>{children}</button>; }",
        'page.tsx': "'use client';\nimport { Button } from './button';\nexport function Page() { function handleSave() {} return <Button onClick={handleSave}>Save</Button>; }",
      }),
    );
    expect(result.features.map((item) => [item.title, item.entry.path])).toEqual([['Save', 'page.tsx']]);
  });
});

describe('effect adapters', () => {
  it('recognises Supabase, Drizzle, axios, router.push, Stripe and Resend', () => {
    const result = analyzeRepository(
      snap({
        'a.tsx': [
          "'use client';",
          "import axios from 'axios';",
          "import { createClient } from '@supabase/supabase-js';",
          "import { drizzle } from 'drizzle-orm/node-postgres';",
          "import { useRouter } from 'next/navigation';",
          "import Stripe from 'stripe';",
          "import { Resend } from 'resend';",
          "const supabase = createClient('u', 'k');",
          'const db = drizzle(pool);',
          "const stripe = new Stripe('k');",
          "const resend = new Resend('k');",
          'export function A() {',
          '  const router = useRouter();',
          '  async function go() {',
          "    await supabase.from('notes').insert({});",
          "    await supabase.from('notes').select('*');",
          '    await db.insert(notes).values({});',
          "    await axios.post('/api/x', {});",
          '    await stripe.checkout.sessions.create({});',
          '    await resend.emails.send({});',
          "    router.push('/done');",
          '  }',
          '  return <button onClick={go}>Go</button>;',
          '}',
        ].join('\n'),
      }),
    );
    expect(result.features[0]!.effects.map((effect) => [effect.kind, effect.label])).toEqual([
      ['db-write', 'writes notes'],
      ['db-read', 'reads notes'],
      ['db-write', 'writes notes'],
      ['api-call', 'POST /api/x'],
      ['payment', 'stripe checkout.sessions'],
      ['email', 'sends email'],
      ['navigation', 'navigates to /done'],
    ]);
  });

  it('marks a request with a computed address as unknown', () => {
    const result = analyzeRepository(snap({ 'a.tsx': "'use client';\nexport function A({ url }) { return <button onClick={() => fetch(url)}>Load</button>; }" }));
    const request = result.features[0]!.steps[1]!;
    expect(request).toMatchObject({ stage: 'request', confidence: 'gap' });
    expect(request.unknownReason).toMatch(/worked out while the app runs/);
  });

  it('marks a call into a missing project file as unknown, not as a package', () => {
    const result = analyzeRepository(
      snap({
        ...TSCONFIG,
        'a.tsx': "'use client';\nimport { track } from '@/analytics/client';\nimport { clsx } from 'clsx';\nexport function A() { return <button onClick={() => { track('x'); clsx('a'); }}>Go</button>; }",
      }),
    );
    expect(result.features[0]!.steps.map((step) => [step.title, step.confidence])).toEqual([
      ['You click “Go”', 'conventional'],
      ['Runs track from a missing file', 'gap'],
    ]);
  });

  it('says so when a request goes to an address with no matching API route', () => {
    const result = analyzeRepository(snap({ 'a.tsx': "'use client';\nexport function A() { return <button onClick={() => fetch('/api/missing')}>Load</button>; }" }));
    expect(result.features[0]!.steps.map((step) => step.title)).toContain('Can’t find the code for /api/missing');
  });
});

describe('patterns from real apps', () => {
  it('follows an inline server action in a form and recognises next-auth sign-in and sign-out', () => {
    const result = analyzeRepository(
      snap({
        ...TSCONFIG,
        'lib/auth.ts': "import NextAuth from 'next-auth';\nexport const { handlers, signIn, signOut, auth } = NextAuth({ providers: [] });",
        'app/login/page.tsx': [
          "import { signIn } from '@/lib/auth';",
          'export default function Login() {',
          "  return <form action={async () => { 'use server'; await signIn('github', { redirectTo: '/' }); }}><button>Sign in with GitHub</button></form>;",
          '}',
        ].join('\n'),
        'app/layout.tsx': "import { UserMenu } from './user';\nexport default function Layout({ children }) { return <body><UserMenu />{children}</body>; }",
        'app/user.tsx': [
          "import { signOut } from '@/lib/auth';",
          'export function UserMenu() {',
          "  return <form action={async () => { 'use server'; await signOut(); }}><button type=\"submit\">Sign out</button></form>;",
          '}',
        ].join('\n'),
      }),
    );
    expect(result.features.map((item) => [item.title, item.page, outline(item)])).toEqual([
      ['Sign in with GitHub', '/login', ['form: You press “Sign in with GitHub”', '  request: Sends the data to the server', '    server: The server runs the form’s action', '    external: Starts signing in with github']],
      // Only the layout renders the user menu, so the feature belongs to the layout's route.
      ['Sign out', '/', ['form: You press “Sign out”', '  request: Sends the data to the server', '    server: The server runs the form’s action', '    response: Signs you out']],
    ]);
    expect(result.features[1]!.steps.at(-1)!.concepts).toContain('authentication');
  });
});

describe('server entry points and branches', () => {
  it('turns unreached API routes and server actions into their own features', () => {
    const result = analyzeRepository(
      snap({
        'app/page.tsx': 'export default function Page() { return null; }',
        'app/api/health/route.ts': 'export function GET() { return Response.json({ ok: true }); }',
        'app/actions.ts': "'use server';\nexport async function cleanUp() {}\nasync function helper() {}",
      }),
    );
    expect(result.features.map((item) => [item.title, item.entryKind, item.page])).toEqual([
      ['Check the server is running', 'route-handler', '/api/health'],
      ['Clean up', 'server-action', undefined],
    ]);
    expect(result.features.map((item) => [item.codeName, item.area])).toEqual([
      ['GET /api/health', 'Behind the scenes'],
      [undefined, 'Behind the scenes'],
    ]);
    expect(outline(result.features[0]!)).toEqual(['server: A GET request arrives at /api/health', '  response: Sends back an answer']);
  });

  it('records try/catch as a branch', () => {
    const result = analyzeRepository(
      snap({ 'a.tsx': "'use client';\nexport function A() {\n  async function go() {\n    try { await fetch('https://api.example.com'); } catch { return; }\n  }\n  return <button onClick={go}>Go</button>;\n}" }),
    );
    const item = result.features[0]!;
    expect(item.branches[0]?.condition).toBe('try { … } catch');
    expect(outline(item)).toEqual(['click: You click “Go”', '  client: Runs go', '    check: Tries the next steps, ready for errors', '    external: Calls api.example.com', '    client: Stops early']);
  });

  it('stops at the step limit and marks the feature partial', () => {
    const calls = Array.from({ length: 80 }, (_, index) => `set${index % 2 ? 'A' : 'B'}(${index});`).join(' ');
    const result = analyzeRepository(snap({ 'a.tsx': `'use client';\nimport { useState } from 'react';\nexport function A() { const [a, setA] = useState(0); const [b, setB] = useState(0); return <button onClick={() => { ${calls} }}>Go</button>; }` }));
    expect(result.features[0]!.steps).toHaveLength(60);
    expect(result.features[0]!.partial).toBe(true);
  });
});
