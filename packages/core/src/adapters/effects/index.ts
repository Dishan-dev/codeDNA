import ts from 'typescript';
import type { Confidence, EffectKind, StepStage } from '@codedna/shared';
import { unwrap, type Callee, type Origin } from '../../graph/resolve.js';

/** A recognised call: what the step shows and, when it changes something, which effect it is. */
export interface EffectMatch {
  effect?: EffectKind;
  stage: StepStage;
  title: string;
  plain: string;
  /** Chip text, e.g. "writes order". */
  label: string;
  confidence: Confidence;
  /** Friendly reason when part of the call is only known at runtime. */
  unknownReason?: string;
  /** For `fetch`/axios: the request so the caller can follow it into an API route. */
  request?: { method: string; url?: string };
  /** Sign-in checks are steps, not effects; this lets later stages tag them. */
  auth?: boolean;
  /** For a state setter: the state it changes. */
  state?: string;
  /** Redirect and not-found calls stop the function, like a return. */
  exits?: boolean;
}

const PRISMA_WRITE: Record<string, string> = { create: 'Saves a new', createMany: 'Saves new', update: 'Updates a', updateMany: 'Updates', upsert: 'Saves or updates a', delete: 'Deletes a', deleteMany: 'Deletes' };
const PRISMA_READ = new Set(['findMany', 'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy']);
const VALIDATE = new Set(['parse', 'safeParse', 'parseAsync', 'safeParseAsync']);
const HTTP = new Set(['get', 'post', 'put', 'patch', 'delete', 'head']);
const AUTH_MODULES = /^(?:next-auth|@auth\/|@clerk\/nextjs|lucia|better-auth|@supabase\/auth-helpers)/;
const AUTH_NAMES = new Set(['auth', 'getServerSession', 'currentUser', 'getAuth', 'getSession', 'getUser', 'getCurrentUser', 'validateRequest']);

/** next-auth signIn('github') / signOut(): hand over to a sign-in provider, or end the session. */
function signInOut(name: string, provider: string | undefined, module: string): EffectMatch | undefined {
  if (name === 'signIn')
    return { stage: 'external', title: provider ? `Starts signing in with ${provider}` : 'Starts signing in', plain: `Hands over to ${provider ? code(provider) : 'the sign-in provider'} to check who you are; you come back signed in. (${code(module)})`, label: 'signs in', confidence: 'conventional', auth: true, exits: true };
  if (name === 'signOut') return { stage: 'response', title: 'Signs you out', plain: `Ends your session, so the app forgets who you are. (${code(module)})`, label: 'signs out', confidence: 'conventional', auth: true };
  return undefined;
}

const short = (text: string, max = 60) => {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};
const code = (text: string) => `\`${short(text)}\``;

/** Literal text, or a template with `${…}` placeholders; undefined when computed. */
export function literalText(node: ts.Expression | undefined): { text: string; templated: boolean } | undefined {
  if (!node) return undefined;
  const value = unwrap(node);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return { text: value.text, templated: false };
  if (ts.isTemplateExpression(value)) return { text: value.head.text + value.templateSpans.map((span) => `\${…}${span.literal.text}`).join(''), templated: true };
  return undefined;
}
function propertyText(node: ts.Expression | undefined, name: string): string | undefined {
  const value = node && unwrap(node);
  if (!value || !ts.isObjectLiteralExpression(value)) return undefined;
  for (const property of value.properties)
    if (ts.isPropertyAssignment(property) && property.name.getText() === name) return literalText(property.initializer)?.text;
  return undefined;
}
const fromModule = (origin: Origin | undefined, pattern: RegExp) => origin?.kind === 'external' && pattern.test(origin.module);

function request(kind: 'fetch' | 'axios', method: string, urlNode: ts.Expression | undefined): EffectMatch {
  const url = literalText(urlNode);
  const how = kind === 'fetch' ? '`fetch`' : '`axios`';
  if (!url)
    return {
      effect: 'api-call',
      stage: 'request',
      title: `Sends a ${method} request`,
      plain: `Sends a ${method} request with ${how}. The address is worked out while the app runs, so CodeDNA can't tell where it goes.`,
      label: `${method} (address decided at runtime)`,
      confidence: 'gap',
      unknownReason: 'The address of this request is worked out while the app runs, so CodeDNA can’t tell which server code answers it.',
      request: { method },
    };
  const external = /^https?:\/\//.test(url.text);
  return {
    effect: 'api-call',
    stage: external ? 'external' : 'request',
    title: external ? `Calls ${/^https?:\/\/([^/?#]+)/.exec(url.text)?.[1] ?? 'another service'}` : `Sends a ${method} request to ${url.text}`,
    plain: external ? `Sends a ${method} request to another service at ${code(url.text)}.` : `Sends a ${method} request to ${code(url.text)} on your own server.`,
    label: `${method} ${url.text}`,
    confidence: 'conventional',
    request: { method, url: url.text },
  };
}

/** "ADMIN_ENDPOINTS.bankOfficers" or `${ENDPOINTS.users}/${id}` → "bank officers" / "users". */
function endpointName(node: ts.Expression | undefined): string | undefined {
  let value = node && unwrap(node);
  if (value && ts.isTemplateExpression(value) && !value.head.text) value = unwrap(value.templateSpans[0]!.expression);
  if (value && ts.isPropertyAccessExpression(value)) return value.name.text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').toLowerCase();
  return undefined;
}

/**
 * A call on an axios client made in the app (`const api = axios.create({ baseURL })`): the
 * request goes to a back-end whose address is set up once, usually a separate server.
 */
function clientRequest(root: string, method: string, urlNode: ts.Expression | undefined): EffectMatch {
  const url = literalText(urlNode);
  const known = url && !url.text.startsWith('${') ? url.text : undefined;
  const where = known ?? endpointName(urlNode);
  return {
    effect: 'api-call',
    stage: 'external',
    title: `Sends a ${method} request to the API${where ? ` (${short(where, 40)})` : ''}`,
    plain: `Sends a ${method} request with ${code(root)}, the app’s axios client, to its back-end API${where ? ` at ${code(where)}` : ''}. The back-end’s code isn’t followed here; the story picks up again when its answer comes back.`,
    label: `API ${method} ${where ?? ''}`.trim(),
    confidence: 'conventional',
    request: { method, ...(known && known.startsWith('/') ? { url: known } : {}) },
  };
}

/** Recognise framework and library calls. Unknown calls return undefined and are not steps. */
export function classifyCall(callee: Callee, call: ts.CallExpression): EffectMatch | undefined {
  const args = call.arguments;
  const first = (index: number) => callee.kind === 'external' || callee.kind === 'global' || callee.kind === 'value' ? callee.calls[index]?.arguments[0] : undefined;

  if (callee.kind === 'state-setter')
    return { effect: 'local-state', stage: 'screen', title: `Updates ${callee.state} on the screen`, plain: `Changes ${code(callee.state)}, so React redraws the parts of the screen that show it.`, label: `updates ${callee.state}`, confidence: 'conventional', state: callee.state };

  if (callee.kind === 'global') {
    if (callee.name === 'fetch' && !callee.chain.length) return request('fetch', (propertyText(args[1], 'method') ?? 'GET').toUpperCase(), args[0]);
    return undefined;
  }

  if (callee.kind === 'external') {
    const { module, name, chain } = callee;
    const where = literalText(args[0])?.text;
    if (module === 'next/navigation' && (name === 'redirect' || name === 'permanentRedirect'))
      return { effect: 'redirect', stage: 'screen', title: `Sends you to ${where ?? 'another page'}`, plain: `Sends the user to ${where ? code(where) : 'another page'}. Nothing after this line runs.`, label: `redirects to ${where ?? '…'}`, confidence: 'conventional', exits: true };
    if (module === 'next/navigation' && name === 'notFound')
      return { effect: 'redirect', stage: 'screen', title: 'Shows the “not found” page', plain: 'Stops here and shows the “page not found” screen.', label: 'shows not found', confidence: 'conventional', exits: true };
    if (module === 'next/cache' && (name === 'revalidatePath' || name === 'revalidateTag'))
      return { effect: 'revalidate', stage: 'response', title: `Refreshes ${where ?? 'cached data'}`, plain: `Tells Next.js that the data for ${where ? code(where) : 'this page'} changed, so it is loaded fresh next time.`, label: `refreshes ${where ?? 'cache'}`, confidence: 'conventional' };
    if (module === 'next/headers' && name === 'cookies') {
      const method = chain[0];
      const cookie = literalText(callee.calls[1]?.arguments[0])?.text;
      if (method === 'get' || method === 'has')
        return { effect: 'cookie', stage: 'check', title: `Reads the ${cookie ?? ''} cookie`.replace('  ', ' '), plain: `Reads ${cookie ? `the ${code(cookie)} cookie` : 'a cookie'} that the browser sent with the request.`, label: `reads cookie ${cookie ?? ''}`.trim(), confidence: 'conventional', auth: !!cookie && /session|token|auth/i.test(cookie) };
      if (method === 'set' || method === 'delete')
        return { effect: 'cookie', stage: 'response', title: `${method === 'set' ? 'Saves' : 'Removes'} the ${cookie ?? ''} cookie`.replace('  ', ' '), plain: `${method === 'set' ? 'Stores' : 'Removes'} ${cookie ? `the ${code(cookie)} cookie` : 'a cookie'} in the browser.`, label: `${method === 'set' ? 'sets' : 'removes'} cookie ${cookie ?? ''}`.trim(), confidence: 'conventional' };
      return undefined;
    }
    if (module === 'axios' && name === 'default') {
      if (!chain.length) return request('axios', (propertyText(args[0], 'method') ?? 'GET').toUpperCase(), undefined);
      if (chain.length === 1 && HTTP.has(chain[0]!)) return request('axios', chain[0]!.toUpperCase(), args[0]);
    }
    if (AUTH_MODULES.test(module) && !chain.length && (name === 'signIn' || name === 'signOut')) return signInOut(name, where, module);
    if (AUTH_MODULES.test(module) && AUTH_NAMES.has(name) && !chain.length)
      return { stage: 'check', title: 'Checks who is signed in', plain: `Asks ${code(module)} who the signed-in user is.`, label: 'checks sign-in', confidence: 'conventional', auth: true };
    return undefined;
  }

  if (callee.kind === 'value') {
    const { chain, init, root } = callee;
    const last = chain[chain.length - 1] ?? '';
    // Prisma: prisma.<model>.<method>()
    const prisma = fromModule(init, /^@prisma\/client/) || (!init && /^(?:prisma|db)$/i.test(root));
    if (prisma && chain.length === 2) {
      const model = chain[0]!;
      const confidence: Confidence = init ? 'conventional' : 'heuristic';
      if (PRISMA_WRITE[last])
        return { effect: 'db-write', stage: 'database', title: `${PRISMA_WRITE[last]} ${model}`.replace(/ a ([aeiou])/i, ' an $1'), plain: `${PRISMA_WRITE[last]} ${code(model)} in the database with Prisma.`.replace(/ a `([aeiou])/i, ' an `$1'), label: `writes ${model}`, confidence };
      if (PRISMA_READ.has(last))
        return { effect: 'db-read', stage: 'database', title: `Reads ${model} from the database`, plain: `Looks up ${code(model)} records in the database with Prisma.`, label: `reads ${model}`, confidence };
    }
    // Supabase: supabase.from('table').insert() / .select(), supabase.auth.getUser()
    const supabase = fromModule(init, /^@supabase\//) || (!init && /supabase/i.test(root));
    if (supabase) {
      if (chain[0] === 'auth' && (last === 'getUser' || last === 'getSession'))
        return { stage: 'check', title: 'Checks who is signed in', plain: 'Asks Supabase who the signed-in user is.', label: 'checks sign-in', confidence: init ? 'conventional' : 'heuristic', auth: true };
      if (chain[0] === 'from') {
        const table = literalText(first(0))?.text ?? 'a table';
        const op = chain[1] ?? '';
        if (['insert', 'update', 'upsert', 'delete'].includes(op))
          return { effect: 'db-write', stage: 'database', title: `Writes to ${table}`, plain: `Changes the ${code(table)} table in Supabase (${op}).`, label: `writes ${table}`, confidence: init ? 'conventional' : 'heuristic' };
        if (op === 'select') return { effect: 'db-read', stage: 'database', title: `Reads ${table}`, plain: `Reads rows from the ${code(table)} table in Supabase.`, label: `reads ${table}`, confidence: init ? 'conventional' : 'heuristic' };
      }
    }
    // Drizzle: db.insert(table) / db.select().from(table)
    if (fromModule(init, /^drizzle-orm/)) {
      const table = first(0)?.getText() ?? 'a table';
      if (['insert', 'update', 'delete'].includes(chain[0] ?? ''))
        return { effect: 'db-write', stage: 'database', title: `Writes to ${table}`, plain: `Changes ${code(table)} in the database with Drizzle.`, label: `writes ${table}`, confidence: 'conventional' };
      if (chain[0] === 'select' || chain[0] === 'query') return { effect: 'db-read', stage: 'database', title: 'Reads from the database', plain: 'Reads rows from the database with Drizzle.', label: 'reads database', confidence: 'conventional' };
    }
    // An axios client made in the app: const api = axios.create(); api.put('/x')
    if (fromModule(init, /^axios$/) && chain.length === 1 && HTTP.has(last)) return clientRequest(root, last.toUpperCase(), args[0]);
    // zod: Schema.parse() / safeParse()
    if (chain.length === 1 && VALIDATE.has(last)) {
      const zod = fromModule(init, /^zod$/);
      if (zod || /schema$/i.test(root))
        return { effect: 'validation', stage: 'check', title: `Checks the data with ${root}`, plain: `Checks that the data has the right shape using ${code(root)}${last.startsWith('safe') ? ', without crashing if it doesn’t' : ''}.`, label: `validates with ${root}`, confidence: zod ? 'conventional' : 'heuristic' };
    }
    // Next.js router: const router = useRouter(); router.push('/x')
    if (fromModule(init, /^next\/(?:navigation|router)$/) && init?.kind === 'external' && init.name === 'useRouter' && chain.length === 1) {
      const where = literalText(args[0])?.text;
      if (last === 'push' || last === 'replace')
        return { effect: 'navigation', stage: 'screen', title: `Opens ${where ?? 'another page'}`, plain: `Moves the user to ${where ? code(where) : 'another page'} without reloading the browser.`, label: `navigates to ${where ?? '…'}`, confidence: 'conventional' };
      if (last === 'refresh') return { effect: 'navigation', stage: 'screen', title: 'Refreshes the page', plain: 'Reloads the data on the current page.', label: 'refreshes page', confidence: 'conventional' };
      if (last === 'back') return { effect: 'navigation', stage: 'screen', title: 'Goes back', plain: 'Takes the user back to the previous page.', label: 'goes back', confidence: 'conventional' };
    }
    // Email and payments.
    if (fromModule(init, /^resend$/) && chain.join('.') === 'emails.send')
      return { effect: 'email', stage: 'external', title: 'Sends an email', plain: 'Sends an email through Resend.', label: 'sends email', confidence: 'conventional' };
    if (fromModule(init, /^nodemailer$/) && last === 'sendMail')
      return { effect: 'email', stage: 'external', title: 'Sends an email', plain: 'Sends an email through Nodemailer.', label: 'sends email', confidence: 'conventional' };
    if (fromModule(init, /^stripe$/) && last === 'create')
      return { effect: 'payment', stage: 'external', title: 'Talks to Stripe', plain: `Asks Stripe to create ${code(chain.slice(0, -1).join('.'))}.`, label: `stripe ${chain.slice(0, -1).join('.')}`, confidence: 'conventional' };
    // Auth helpers made from a library, e.g. `export const { auth } = NextAuth(config)`.
    if (init?.kind === 'external' && AUTH_MODULES.test(init.module) && !chain.length && (root === 'signIn' || root === 'signOut')) return signInOut(root, literalText(args[0])?.text, init.module);
    if (init?.kind === 'external' && AUTH_MODULES.test(init.module) && !chain.length && AUTH_NAMES.has(root))
      return { stage: 'check', title: 'Checks who is signed in', plain: `Asks ${code(init.module)} who the signed-in user is.`, label: 'checks sign-in', confidence: 'conventional', auth: true };
  }
  return undefined;
}
