import type { Feature } from '@codedna/shared';
import { humanize } from './captions.js';

/**
 * Plain names and app parts for features, worked out only from what the trace already knows:
 * the button text, the function it runs, the data it touches and the page it is on.
 *
 * - A clear button label ("Place order", "Save to favorites") is kept as it is.
 * - A vague one gets its subject: "Delete" + deleteProduct() → "Delete a product".
 * - A name made from code loses its code words: "searchAction" → "Search".
 * - An API route says what it is for: "GET /api/seed" → "Fill the database with sample data".
 *
 * The original code name is kept as `codeName`, so the learner can still find it in the code.
 */

/** Button words that say what happens but not to what. */
const VAGUE = new Set(['delete', 'remove', 'save', 'edit', 'update', 'add', 'create', 'new', 'submit', 'send', 'search', 'find', 'filter', 'sort', 'confirm', 'apply', 'go', 'ok', 'done', 'continue', 'next', 'upload', 'download', 'export', 'import', 'share', 'like', 'follow', 'buy', 'pay', 'book', 'reset', 'clear', 'refresh', 'load more', 'view', 'open', 'close', 'archive', 'publish', 'post', 'join']);
/** Verbs that read better with a plural subject: "Search products", not "Search a product". */
const PLURAL_VERBS = new Set(['search', 'find', 'filter', 'sort', 'export', 'import', 'refresh', 'clear', 'load more', 'view']);
/** First words of function names that are verbs, so the rest is the subject: deleteProduct → product. */
const VERBS = new Set(['delete', 'remove', 'save', 'create', 'add', 'update', 'edit', 'toggle', 'place', 'apply', 'submit', 'send', 'search', 'find', 'get', 'fetch', 'load', 'upload', 'export', 'import', 'post', 'put', 'patch', 'publish', 'archive', 'buy', 'pay', 'book', 'like', 'follow', 'share', 'register', 'insert', 'upsert', 'set', 'clear', 'reset', 'filter']);
/** Words that are about code, not about what the person does. */
const CODE_WORDS = /\s+(?:action|actions|handler|callback|fn|function|func|submit|click|event|async|server)$/;
/** Button words that only say "send this", so the page has to say what. */
const SEND_WORDS = new Set(['submit', 'save', 'send', 'confirm', 'continue', 'done', 'ok', 'create', 'add', 'update', 'submit the form', 'save changes']);
/** Page path words that describe an action on the section rather than the section itself. */
const ACTION_SEGMENTS = new Set(['create', 'new', 'edit', 'update', 'add', 'delete', 'view', 'details']);

const ROUTE_PURPOSE: { match: RegExp; title: string }[] = [
  { match: /^seed$/, title: 'Fill the database with sample data' },
  { match: /^(?:\[\.\.\.nextauth\]|nextauth|auth)$/, title: 'Handle signing in' },
  { match: /^(?:webhooks?|hooks?)$/, title: 'Receive webhook events' },
  { match: /^cron$/, title: 'Run a scheduled job' },
  { match: /^(?:health|healthz|ping|status)$/, title: 'Check the server is running' },
  { match: /^query$/, title: 'Run a database query' },
  { match: /^revalidate$/, title: 'Refresh cached pages' },
  { match: /^upload$/, title: 'Upload a file' },
  { match: /^(?:og|opengraph-image)$/, title: 'Make a preview image' },
];
const METHOD_VERB: Record<string, string> = { GET: 'Load', POST: 'Send', PUT: 'Update', PATCH: 'Update', DELETE: 'Delete', HEAD: 'Check', OPTIONS: 'Check' };

const AUTH_TITLE = /\b(?:sign|log)\s?(?:in|out|up)\b|\bregister\b|\bpassword\b|\bsign-in\b/i;
const AUTH_STEP = /\bsign(?:s|ing)? (?:you )?(?:in|out)\b/i;

export const AREA_AUTH = 'Signing in';
export const AREA_SERVER = 'Behind the scenes';
export const AREA_HOME = 'Home page';

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const singular = (word: string) => (/ies$/.test(word) ? word.replace(/ies$/, 'y') : /(?:ss|us)$/.test(word) ? word : word.replace(/s$/, ''));
const plural = (word: string) => (/[^aeiou]y$/.test(word) ? word.replace(/y$/, 'ies') : /(?:s|x|ch|sh)$/.test(word) ? word : `${word}s`);
const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/** "deleteInvoiceWithId" → "invoice"; "placeOrder" → "order"; "searchAction" → undefined. */
export function subjectOfFunction(name: string | undefined): string | undefined {
  if (!name || /[^\w$]/.test(name)) return undefined;
  const words = humanize(name).toLowerCase().split(/\s+/);
  if (words.length < 2 || !VERBS.has(words[0]!)) return undefined;
  const rest: string[] = [];
  for (const word of words.slice(1)) {
    if (/^(?:with|by|for|from|to|in|on|action|actions|handler|async|fn|id|ids|data|form)$/.test(word)) break;
    rest.push(word);
  }
  return rest.length && rest.length <= 3 ? singular(rest.join(' ')) : undefined;
}

/** "/dashboard/invoices/[id]/edit" → "invoices"; "/" → undefined. Route groups like (shop) are ignored. */
export function sectionOf(route: string | undefined): string | undefined {
  if (!route) return undefined;
  const segments = route.split('/').filter((segment) => segment && !/^\(.*\)$/.test(segment) && !/^\[.*\]$/.test(segment) && !ACTION_SEGMENTS.has(segment.toLowerCase()));
  const last = segments[segments.length - 1];
  return last ? last.replace(/[-_]+/g, ' ').toLowerCase() : undefined;
}

const CODE_FOLDERS = /^(?:_.*|components?|ui|lib|libs|hooks|utils?|helpers?|sections?|widgets?|partials?|containers?|context|contexts|providers?|store|stores|services?|types?|constants?|styles?|assets?)$/i;
/** The page a file belongs to, from its place under `app/`: app/dashboard/invoices/error.tsx → /dashboard/invoices. */
export function routeOfFile(path: string): string | undefined {
  const match = /(?:^|\/)app\/(.*)$/.exec(path);
  if (!match) return undefined;
  // Folders that hold code, not pages: app/orders/components/list.tsx belongs to /orders.
  const folders = match[1]!.split('/').slice(0, -1);
  const end = folders.findIndex((folder) => CODE_FOLDERS.test(folder));
  return `/${(end < 0 ? folders : folders.slice(0, end)).join('/')}`;
}

/** The data a feature is about: from the function it runs, then the data it saves or reads. */
function subjectOf(feature: Feature, handler: string | undefined): string | undefined {
  const fromFunction = subjectOfFunction(handler);
  if (fromFunction) return fromFunction;
  const data = feature.effects.find((effect) => effect.kind === 'db-write') ?? feature.effects.find((effect) => effect.kind === 'db-read');
  const model = data && /^(?:writes|reads) ([A-Za-z][\w ]{0,30})$/.exec(data.label)?.[1];
  return model && !/^(?:cookie|session|header)/i.test(model) ? singular(model.toLowerCase()) : undefined;
}

function routeTitle(method: string, route: string, subject: string | undefined): string {
  const segments = route.split('/').filter((segment) => segment && segment !== 'api' && !/^\(.*\)$/.test(segment));
  const last = [...segments].reverse().find((segment) => !/^\[[^.]/.test(segment)) ?? '';
  const purpose = ROUTE_PURPOSE.find((item) => item.match.test(last.toLowerCase()));
  if (purpose) return purpose.title;
  const object = subject ? (method === 'GET' ? plural(subject) : subject) : last.replace(/[-_]+/g, ' ').toLowerCase();
  return object ? `${METHOD_VERB[method] ?? 'Answer'} ${object}` : `Answer ${method} requests`;
}

function readableTitle(feature: Feature, handler: string | undefined): string {
  if (feature.entryKind === 'link') return feature.title;
  const route = feature.entryKind === 'route-handler' ? /^([A-Z]+) (\S+)$/.exec(feature.title) : null;
  const subject = subjectOf(feature, handler) ?? (feature.entryKind === 'route-handler' ? undefined : singularSection(feature));
  if (route) return routeTitle(route[1]!, route[2]!, subjectOf(feature, handler));
  if (/^Type in /.test(feature.title)) return feature.title;
  // Code words at the end of a name made from a function: "Search action" → "Search".
  // Button decorations go too: "+ Add Credit Card" → "Add Credit Card", "Show all ->" → "Show all".
  const cleaned = feature.title.replace(CODE_WORDS, '').replace(/^[+•*·→>]+\s*/, '').replace(/\s*(?:->|→|»|>)$/, '').trim() || feature.title;
  const verb = cleaned.toLowerCase();
  // "Submit" on /admin/branch-management/add adds a branch: the page says what is being sent.
  const pageRoute = feature.page ?? routeOfFile(feature.entry.path);
  if (SEND_WORDS.has(verb) && !subjectOfFunction(handler) && pageRoute && ACTION_SEGMENTS.has(lastSegment(pageRoute))) {
    const page = pageTitleOf(pageRoute);
    const action = page && /^(Add|Edit|Delete|View) (.+)$/.exec(page);
    if (action) return `${action[1]} ${article(action[2]!)} ${action[2]}`;
    if (page) return page;
  }
  if (VAGUE.has(verb) && subject && !subject.includes(verb)) return capital(PLURAL_VERBS.has(verb) ? `${verb} ${plural(subject)}` : `${verb} ${article(subject)} ${subject}`);
  return cleaned;
}

function singularSection(feature: Feature): string | undefined {
  const section = sectionOf(feature.page ?? routeOfFile(feature.entry.path));
  return section && !section.includes(' ') ? singular(section) : undefined;
}

const ACTION_VERB: Record<string, string> = { create: 'Add', new: 'Add', add: 'Add', edit: 'Edit', update: 'Edit', delete: 'Delete', view: 'View', details: 'View' };
/** Words that name a screen for managing things rather than the things: "bank officer management" → "bank officer". */
const SCREEN_WORDS = /\s+(?:management|manager|list|overview|admin|page|screen|dashboard)$/;
const segmentsOf = (route: string) => route.split('/').filter((segment) => segment && !/^\(.*\)$/.test(segment));
const words = (segment: string) => segment.replace(/[-_]+/g, ' ').toLowerCase().trim();
const isDynamic = (segment: string) => /^\[.*\]$/.test(segment);
const lastSegment = (route: string) => (segmentsOf(route).pop() ?? '').toLowerCase();

/**
 * The page in plain words: "/" → "Home page", "/admin/audit-logs" → "Audit logs",
 * "/admin/bank-officer-management/add" → "Add bank officer", "/invoices/[id]/edit" → "Edit invoice",
 * "/orders/[id]" → "Order details".
 */
export function pageTitleOf(route: string | undefined): string | undefined {
  if (route === undefined) return undefined;
  const segments = segmentsOf(route);
  const named = segments.filter((segment) => !isDynamic(segment) && !ACTION_SEGMENTS.has(segment.toLowerCase()));
  const subject = named.length ? words(named[named.length - 1]!) : undefined;
  if (!subject) return segments.length ? undefined : AREA_HOME;
  const thing = singular(subject.replace(SCREEN_WORDS, '') || subject);
  const last = (segments[segments.length - 1] ?? '').toLowerCase();
  if (ACTION_VERB[last]) return `${ACTION_VERB[last]} ${thing}`;
  if (isDynamic(last)) return capital(`${thing} details`);
  return capital(subject);
}

/**
 * The bigger part of the app: the first folder of a deeper route, so /admin/audit-logs and
 * /admin/branch-management are both in "Admin". Shallow routes are their own part.
 */
export function sectionOfFeature(feature: Feature, area: string): string {
  if (area === AREA_AUTH || area === AREA_SERVER || area === AREA_HOME || area === 'Other') return area;
  const route = feature.page ?? routeOfFile(feature.entry.path);
  const named = route ? segmentsOf(route).filter((segment) => !isDynamic(segment)) : [];
  return named.length >= 2 && !ACTION_SEGMENTS.has(named[0]!.toLowerCase()) ? capital(words(named[0]!)) : area;
}

/** Small screen details: closing a box, clearing a filter, paging, a button with no words. */
const SMALL = /^(?:x|×|✕|ok|close\b.*|cancel\b.*|clear\b.*|reset(?: filters?)?|dismiss\b.*|(?:open|close|toggle|show|hide)\s+(?:the\s+)?(?:menu|sidebar|drawer|nav\w*|password)\b.*|.*\b(?:menu|modal|overlay|dialog|popup|tooltip)\b.*|show (?:all|more|less)\b.*|hide\b.*|learn more|read more|see (?:all|more)\b.*|click the (?:button|link)|click here|previous(?: page)?|next(?: page)?|prev|back\b.*|go back\b.*|edit|change|how is this calculated\??)$/i;
const REACHES_OUT = new Set(['db-write', 'db-read', 'api-call', 'email', 'payment', 'redirect', 'revalidate', 'cookie']);

/**
 * Is this something a person sets out to do, or a small detail on the way? Lessons and the
 * overview are built from the main ones; details stay one click away.
 */
export function importanceOf(feature: Feature): 'main' | 'detail' {
  if (feature.entryKind === 'route-handler' || feature.entryKind === 'server-action' || feature.entryKind === 'form-action') return 'main';
  if (feature.entryKind === 'link' || /^Type in /.test(feature.title)) return 'detail';
  if (feature.steps.some((step) => step.stage === 'request' || step.stage === 'server') || feature.effects.some((effect) => REACHES_OUT.has(effect.kind))) return 'main';
  const plain = feature.title.replace(/\s*\([^)]*\)$/, '').trim();
  if (AUTH_TITLE.test(plain)) return 'main';
  if (SMALL.test(plain)) return 'detail';
  // A button that only opens another page is a link in disguise.
  if (feature.effects.length && feature.effects.every((effect) => effect.kind === 'navigation')) return 'detail';
  // Something CodeDNA could not follow counts: it is where the work happens.
  return feature.steps.length >= 3 ? 'main' : 'detail';
}

/** The part of the app a feature belongs to, as a person would name it. */
export function areaOf(feature: Feature): string {
  const authSteps = feature.steps.some((step) => AUTH_STEP.test(step.title));
  if (AUTH_TITLE.test(feature.title) || authSteps || /^\/(?:login|signin|sign-in|signup|sign-up|register)\b/.test(feature.page ?? '')) return AREA_AUTH;
  if (feature.entryKind === 'route-handler') return AREA_SERVER;
  // A server function's file says nothing about pages (app/actions.ts is not the home page).
  if (feature.entryKind === 'server-action' && !feature.page) return AREA_SERVER;
  const route = feature.page ?? routeOfFile(feature.entry.path);
  if (route === undefined) return 'Other';
  const section = sectionOf(route);
  return section ? capital(section) : AREA_HOME;
}

/**
 * Give every feature a plain title, its code name and its app part. Titles that would collide
 * (two apps in one repo with the same route) get the folder they live in.
 */
export function nameFeatures(features: Feature[], handlers: ReadonlyMap<string, string>): void {
  for (const feature of features) {
    const title = readableTitle(feature, handlers.get(feature.id));
    if (title !== feature.title) feature.codeName = handlers.get(feature.id) ?? feature.title;
    feature.title = title;
    feature.area = areaOf(feature);
    feature.section = sectionOfFeature(feature, feature.area);
    const pageTitle = feature.entryKind === 'route-handler' ? undefined : pageTitleOf(feature.page ?? routeOfFile(feature.entry.path));
    if (pageTitle) feature.pageTitle = pageTitle;
    feature.importance = importanceOf(feature);
  }
  const byTitle = new Map<string, Feature[]>();
  for (const feature of features) if (feature.entryKind !== 'link') byTitle.set(`${feature.area}|${feature.title}`, [...(byTitle.get(`${feature.area}|${feature.title}`) ?? []), feature]);
  for (const same of byTitle.values()) {
    if (same.length < 2) continue;
    const folders = same.map((feature) => feature.entry.path.split('/'));
    const differ = folders[0]!.findIndex((part, index) => folders.some((other) => other[index] !== part));
    if (differ < 0) continue;
    for (const [index, feature] of same.entries()) feature.title = `${feature.title} (${folders[index]![differ]})`;
  }
}
