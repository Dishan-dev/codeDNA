import { describe, expect, it } from 'vitest';
import { analyzeRepository } from '../analyze.js';
import { pageTitleOf, routeOfFile, sectionOf, subjectOfFunction } from './naming.js';

const snap = (files: Record<string, string>) => ({
  schemaVersion: '1.0',
  id: 'demo',
  files: Object.entries(files).map(([path, content]) => ({ id: path, path, content })),
});
const titles = (files: Record<string, string>) =>
  analyzeRepository(snap(files))
    .features.filter((feature) => feature.entryKind !== 'link')
    .map((feature) => [feature.title, feature.codeName, feature.area]);

describe('plain feature names', () => {
  it('reads the subject from a function name', () => {
    expect(subjectOfFunction('deleteProduct')).toBe('product');
    expect(subjectOfFunction('deleteInvoiceWithId')).toBe('invoice');
    expect(subjectOfFunction('toggleFavorites')).toBe('favorite');
    expect(subjectOfFunction('searchAction')).toBeUndefined();
    expect(subjectOfFunction('handleClick')).toBeUndefined();
  });

  it('names the section of a page, skipping groups, ids and action words', () => {
    expect(sectionOf('/dashboard/invoices/[id]/edit')).toBe('invoices');
    expect(sectionOf('/(shop)/checkout')).toBe('checkout');
    expect(sectionOf('/')).toBeUndefined();
    expect(routeOfFile('app/dashboard/invoices/error.tsx')).toBe('/dashboard/invoices');
    expect(routeOfFile('src/app/page.tsx')).toBe('/');
    expect(routeOfFile('lib/utils.ts')).toBeUndefined();
  });

  it('gives vague buttons a subject, drops code words, and says what API routes are for', () => {
    // Shaped like Vercel's Next.js dashboard template.
    const result = titles({
      'app/(dashboard)/product.tsx': "import { deleteProduct } from './actions';\nexport function Product() {\n  return <form action={deleteProduct}><button type=\"submit\">Delete</button></form>;\n}",
      'app/(dashboard)/actions.ts': "'use server';\nexport async function deleteProduct(formData: FormData) {}",
      'app/(dashboard)/search.tsx': "'use client';\nexport function Search() {\n  function searchAction(formData: FormData) {}\n  return <form action={searchAction}><input name=\"q\" /></form>;\n}",
      'app/(dashboard)/page.tsx': "import { Product } from './product';\nimport { Search } from './search';\nexport default function Page() { return <><Search /><Product /></>; }",
      'app/api/seed/route.ts': 'export async function GET() { return Response.json({ ok: true }); }',
      'app/dashboard/invoices/page.tsx': "export default function Page() {\n  async function remove() { 'use server'; }\n  return <form action={remove}><button>Delete</button></form>;\n}",
    });
    expect(result).toEqual(
      expect.arrayContaining([
        ['Delete a product', 'deleteProduct', 'Home page'],
        ['Search', 'searchAction', 'Home page'],
        ['Fill the database with sample data', 'GET /api/seed', 'Behind the scenes'],
        // No function subject: the page section names it.
        ['Delete an invoice', 'remove', 'Invoices'],
      ]),
    );
  });

  it('keeps clear button labels and puts sign-in flows together', () => {
    const result = titles({
      'app/checkout/page.tsx': "export default function Page() {\n  async function placeOrder() { 'use server'; }\n  return <form action={placeOrder}><button>Place order</button></form>;\n}",
      'app/login/page.tsx': "export default function Page() {\n  async function go() { 'use server'; }\n  return <form action={go}><button>Sign in with GitHub</button></form>;\n}",
    });
    expect(result).toEqual(expect.arrayContaining([['Place order', undefined, 'Checkout'], ['Sign in with GitHub', undefined, 'Signing in']]));
  });

  it('tells apart two routes with the same name from different folders', () => {
    const result = titles({
      'one/app/query/route.ts': 'export async function GET() { return Response.json({}); }',
      'two/app/query/route.ts': 'export async function GET() { return Response.json({}); }',
    });
    expect(result.map(([title]) => title).sort()).toEqual(['Run a database query (one)', 'Run a database query (two)']);
  });
});

describe('app parts, page names and main flows', () => {
  it('names pages in plain words', () => {
    expect(pageTitleOf('/')).toBe('Home page');
    expect(pageTitleOf('/admin/audit-logs')).toBe('Audit logs');
    expect(pageTitleOf('/admin/bank-officer-management/add')).toBe('Add bank officer');
    expect(pageTitleOf('/dashboard/invoices/[id]/edit')).toBe('Edit invoice');
    expect(pageTitleOf('/orders/[id]')).toBe('Order details');
    expect(routeOfFile('app/bank-officer/add-customer/components/step-two.tsx')).toBe('/bank-officer/add-customer');
  });

  it('puts deeper pages in a bigger part, and tells main flows from small details', () => {
    const page = (body: string) => `'use client';
import { useState } from 'react';
export default function Page() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  function save() { if (!name) { setOpen(true); return; } setName(''); setOpen(false); }
  return <div>${body}</div>;
}`;
    const features = analyzeRepository(
      snap({
        'app/admin/branch-management/add/page.tsx': page('<input placeholder="Branch name" onChange={(e) => setName(e.target.value)} /><button onClick={save}>Submit</button><button onClick={() => setOpen(false)}>Close</button>'),
        'app/admin/audit-logs/page.tsx': page('<button onClick={() => setName("")}>Show all -&gt;</button>'),
      }),
    ).features;
    const row = (title: string) => {
      const feature = features.find((item) => item.title === title);
      return feature && [feature.section, feature.area, feature.pageTitle, feature.importance];
    };
    expect(row('Add a branch')).toEqual(['Admin', 'Branch management', 'Add branch', 'main']);
    expect(row('Close')).toEqual(['Admin', 'Branch management', 'Add branch', 'detail']);
    expect(row('Type in “Branch name”')).toEqual(['Admin', 'Branch management', 'Add branch', 'detail']);
    // "-&gt;" is read as "->", then dropped as decoration.
    expect(row('Show all')).toEqual(['Admin', 'Audit logs', 'Audit logs', 'detail']);
  });

  it('follows a request through the app’s own axios client, even behind a default export', () => {
    const features = analyzeRepository(
      snap({
        'src/api/client.ts': "import axios from 'axios';\nexport const apiClient = axios.create({ baseURL: process.env.API });\nexport default apiClient;",
        'src/api/endpoints.ts': "export const ENDPOINTS = { bankOfficers: '/admin/bank-officers' } as const;",
        'src/api/officers.ts': "import apiClient from './client';\nimport { ENDPOINTS } from './endpoints';\nexport async function updateOfficer(id: number) {\n  const { data } = await apiClient.put(`${ENDPOINTS.bankOfficers}/${id}`, {});\n  return data;\n}",
        'app/admin/officers/page.tsx': "'use client';\nimport { updateOfficer } from '../../../src/api/officers';\nexport default function Page() {\n  return <button onClick={() => updateOfficer(1)}>Save officer</button>;\n}",
      }),
    ).features;
    const save = features.find((feature) => feature.title === 'Save officer')!;
    expect(save.effects.filter((effect) => effect.kind === 'api-call').map((effect) => effect.label)).toEqual(['API PUT bank officers']);
    expect(save.steps.some((step) => step.stage === 'external' && step.title === 'Sends a PUT request to the API (bank officers)')).toBe(true);
    expect(save.importance).toBe('main');
  });
});
