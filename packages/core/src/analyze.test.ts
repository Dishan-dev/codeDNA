import { describe, expect, it } from 'vitest';
import { analyzeRepository } from './analyze.js';

const snap = (files: Record<string, string>, manifests: Record<string, string> = {}) => ({
  schemaVersion: '1.0',
  id: 'demo@abc',
  revision: 'abc',
  files: Object.entries(files).map(([path, content]) => ({ id: path, path, content })),
  manifests: Object.entries(manifests).map(([path, content]) => ({ path, content })),
});
const stable = (result: ReturnType<typeof analyzeRepository>) => ({ ...result, stats: { ...result.stats, durationMs: 0 } });

const NEXT_APP = {
  'app/layout.tsx': 'export default function Layout({ children }) { return children; }',
  'app/page.tsx': "import { OrderForm } from '@/components/order-form';\nexport default function Page() { return <OrderForm />; }",
  'components/order-form.tsx': "'use client';\nimport { placeOrder } from '@/lib/actions';\nexport function OrderForm() { return <form action={placeOrder} />; }",
  'lib/actions.ts': "'use server';\nimport { redirect } from 'next/navigation';\nexport async function placeOrder() { redirect('/done'); }",
  'tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./*"] } } }',
};

describe('analyzeRepository', () => {
  it('summarises a Next.js App Router app', () => {
    const result = analyzeRepository(snap(NEXT_APP, { 'package.json': '{ "dependencies": { "next": "15.0.0", "react": "19.0.0" } }' }));
    expect(result).toMatchObject({ schemaVersion: '2.0', snapshotId: 'demo@abc', revision: 'abc', supported: true, partial: false });
    expect(result.features.map((feature) => feature.title)).toEqual(['Place order']);
    expect(result.framework).toEqual({
      id: 'next-app-router',
      label: 'Next.js (App Router)',
      support: 'full',
      evidence: ['package.json depends on next', 'the code imports from next', '1 page in an app folder'],
    });
    expect(result.files.find((file) => file.path === 'components/order-form.tsx')?.directive).toBe('use client');
    expect(result.files.find((file) => file.path === 'lib/actions.ts')?.directive).toBe('use server');
    expect(result.imports.filter((edge) => edge.target).map((edge) => `${edge.from} -> ${edge.target}`)).toEqual([
      'app/page.tsx -> components/order-form.tsx',
      'components/order-form.tsx -> lib/actions.ts',
    ]);
    expect(result.routes.map((route) => `${route.kind} ${route.route}`)).toEqual(['layout /', 'page /']);
    expect(result.limitations).toEqual([]);
  });

  it('gives limited support to React apps without an app folder', () => {
    const result = analyzeRepository(snap({ 'src/App.tsx': "import { useState } from 'react';\nexport function App() {}" }));
    expect(result.framework).toMatchObject({ id: 'react', support: 'limited' });
    expect(result.limitations).toEqual(['Lessons are built for Next.js App Router apps. Other code is shown, but features may be missing.']);
  });

  it('explains when nothing can be read', () => {
    const result = analyzeRepository(snap({ 'main.py': 'print(1)', 'README.md': '# hi' }));
    expect(result.supported).toBe(false);
    expect(result.framework.id).toBe('unknown');
    expect(result.limitations[0]).toMatch(/TypeScript and JavaScript/);
  });

  it('continues with a partial result when limits are hit', () => {
    const result = analyzeRepository(snap(NEXT_APP), { limits: { maxFiles: 2 } });
    expect(result.partial).toBe(true);
    expect(result.files).toHaveLength(2);
    expect(result.limitations).toContain('Some parts were too big to read — lessons cover the rest.');
  });

  it('stops at the time budget with a partial result', () => {
    let time = 0;
    const result = analyzeRepository(snap(NEXT_APP), { timeBudgetMs: 2, now: () => time++ });
    expect(result.partial).toBe(true);
    expect(result.features).toEqual([]);
    expect(result.limitations).toContain('Some parts were too big to read — lessons cover the rest.');
  });

  it('is deterministic for the same files in any order', () => {
    const forward = analyzeRepository(snap(NEXT_APP));
    const reversed = analyzeRepository(snap(Object.fromEntries(Object.entries(NEXT_APP).reverse())));
    expect(stable(forward)).toEqual(stable(reversed));
  });

  it('ignores malformed package.json instead of failing', () => {
    const result = analyzeRepository(snap({ 'index.ts': 'export {}' }, { 'package.json': '{ nope' }));
    expect(result.framework.id).toBe('unknown');
  });
});
