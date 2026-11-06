import type { Feature } from '@codedna/shared';

/**
 * Requirements coverage, first version: read a requirements document (an SRS, a client brief),
 * split it into requirements, and match each one to the features CodeDNA traced in the code.
 *
 * Matching is by meaning-bearing words (with a small list of synonyms), weighted so rare words
 * count more than common ones. It is a strong hint, not a verdict: the UI says "likely" and shows
 * the words that matched, so a person can judge. Nothing here leaves the browser.
 */

export interface Requirement {
  /** "FR-3" when the document numbers it, otherwise "R12". */
  id: string;
  text: string;
  /** The heading it sits under, e.g. "User management". */
  group?: string;
}

export type CoverageStatus = 'built' | 'partial' | 'missing';

export interface RequirementMatch {
  requirement: Requirement;
  status: CoverageStatus;
  /** 0–1: how much of the requirement's meaning was found in the best features. */
  score: number;
  features: { feature: Feature; score: number; words: string[] }[];
  /** Requirement words found nowhere in the code. */
  missingWords: string[];
}

export interface Coverage {
  matches: RequirementMatch[];
  built: number;
  partial: number;
  missing: number;
  /** Built counts fully, partly built counts half. */
  percent: number;
}

const STOP = new Set(
  'a an the and or but if then else of to in on at by for with from into onto as is are be been being was were will would shall should must may might can could do does did done have has had having this that these those it its their there here which who whom whose what when where why how all any each every some such no not only own same so than too very just also able allow allows allowed user users system app application page screen feature features option options via using use used should able get got make makes made let lets etc'.split(
    ' ',
  ),
);

/** Words that mean the same thing in requirements and in code. Each maps to one key. */
const SYNONYMS: Record<string, string> = {
  login: 'signin',
  logon: 'signin',
  signin: 'signin',
  authenticate: 'signin',
  authentication: 'signin',
  logout: 'signout',
  signout: 'signout',
  signup: 'register',
  register: 'register',
  registration: 'register',
  enrol: 'register',
  enroll: 'register',
  onboard: 'register',
  remove: 'delete',
  delete: 'delete',
  erase: 'delete',
  deactivate: 'delete',
  suspend: 'delete',
  add: 'create',
  create: 'create',
  new: 'create',
  insert: 'create',
  submit: 'create',
  initiate: 'create',
  edit: 'update',
  update: 'update',
  modify: 'update',
  change: 'update',
  save: 'update',
  amend: 'update',
  view: 'view',
  show: 'view',
  display: 'view',
  list: 'view',
  see: 'view',
  browse: 'view',
  read: 'view',
  open: 'view',
  search: 'search',
  find: 'search',
  filter: 'search',
  lookup: 'search',
  query: 'search',
  pay: 'payment',
  payment: 'payment',
  checkout: 'payment',
  purchase: 'payment',
  transfer: 'transfer',
  customer: 'customer',
  client: 'customer',
  account: 'account',
  profile: 'account',
  admin: 'admin',
  administrator: 'admin',
  officer: 'officer',
  staff: 'officer',
  employee: 'officer',
  report: 'report',
  export: 'report',
  download: 'report',
  pdf: 'report',
  receipt: 'report',
  verify: 'verify',
  otp: 'verify',
  validate: 'verify',
  validation: 'verify',
  confirm: 'verify',
  email: 'email',
  mail: 'email',
  notify: 'notify',
  notification: 'notify',
  alert: 'notify',
  history: 'history',
  log: 'history',
  audit: 'history',
  transaction: 'transaction',
  transactions: 'transaction',
  loan: 'loan',
  loans: 'loan',
  credit: 'credit',
  branch: 'branch',
  branches: 'branch',
  beneficiary: 'beneficiary',
  policy: 'policy',
  password: 'password',
  reset: 'reset',
  username: 'username',
  dashboard: 'dashboard',
  cart: 'cart',
  order: 'order',
  favorite: 'favorite',
  favourite: 'favorite',
  coupon: 'coupon',
  discount: 'coupon',
};

/** "Officers" → "officer", "searching" → "search": enough to line up most words. */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('es') && /(?:ch|sh|ss|x)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** The meaning-bearing words of a text, as matching keys. */
export function keywords(text: string): string[] {
  const spaced = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b(sign|log)\s+(in|out|up)\b/gi, '$1$2')
    .toLowerCase();
  const words = spaced.match(/[a-z][a-z0-9]+/g) ?? [];
  const keys: string[] = [];
  for (const word of words) {
    if (STOP.has(word) || word.length < 3) continue;
    // "saved" → "save", "updates" → "update" before the general stem, so synonyms still line up.
    const base = /(?:ed|es)$/.test(word) ? word.slice(0, -1) : word;
    const key = SYNONYMS[word] ?? SYNONYMS[base] ?? SYNONYMS[stem(word)] ?? stem(word);
    if (!STOP.has(key) && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

const ID = /^\s*((?:[A-Z]{1,5}[-_ ]?)\d+(?:\.\d+)*)[.):\s-]+/;
const NUMBER = /^\s*(\d+(?:\.\d+)*)[.)]?\s+(?=[A-Za-z])/;
const BULLET = /^\s*(?:[-*•▪◦]|\[[ x]\])\s+/i;
const MODAL = /\b(?:shall|must|should|will be able to|can|needs? to|is able to|allows?)\b/i;

/**
 * Split a document into requirements: numbered items ("FR-3", "2.1"), bullets, and sentences with
 * "shall/must/should". Headings become the group the next requirements belong to.
 */
export function parseRequirements(text: string): Requirement[] {
  const requirements: Requirement[] = [];
  let group: string | undefined;
  let counter = 0;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const heading = /^#{1,6}\s+(.+)$/.exec(line)?.[1] ?? (/^[A-Z][A-Za-z /&-]{2,60}:?$/.test(line) && line.split(/\s+/).length <= 6 && !MODAL.test(line) ? line.replace(/:$/, '') : undefined);
    if (heading) {
      group = heading.replace(/^\d+(?:\.\d+)*\.?\s*/, '').trim();
      continue;
    }
    const id = ID.exec(line)?.[1]?.replace(/[_ ]/, '-');
    const numbered = NUMBER.exec(line);
    const body = line.replace(ID, '').replace(NUMBER, '').replace(BULLET, '').trim();
    const isItem = !!id || !!numbered || BULLET.test(line) || MODAL.test(line);
    if (!isItem || body.split(/\s+/).length < 3 || keywords(body).length < 2) continue;
    counter++;
    requirements.push({
      id: id ?? (numbered ? `R${numbered[1]}` : `R${counter}`),
      text: body,
      ...(group ? { group } : {}),
    });
  }
  // The same sentence twice (a summary and a detail section) is one requirement.
  return requirements.filter((item, index) => requirements.findIndex((other) => other.text.toLowerCase() === item.text.toLowerCase()) === index);
}

/** Everything a feature is known by: its names, page, part, steps and what it changes. */
function featureWords(feature: Feature): string[] {
  const text = [
    feature.title,
    feature.codeName ?? '',
    feature.page ?? '',
    feature.pageTitle ?? '',
    feature.area ?? '',
    feature.section ?? '',
    // What describes the flow, not its insides: the first steps and the helpers it calls by name.
    // Conditions deep inside ("Checks !formData.password") would make every form match everything.
    ...feature.steps.filter((step) => step.depth <= 1 || (step.depth === 2 && /^Runs \w+$/.test(step.title))).map((step) => step.title),
    ...feature.effects.map((effect) => effect.label),
  ].join(' ');
  return keywords(text.replace(/[/[\]()-]+/g, ' '));
}

const BUILT = 0.55;
/** People named in requirements; they say who acts, not what is built. */
const ACTORS = new Set(['customer', 'client', 'visitor', 'member', 'people', 'person', 'someone', 'guest']);
const PARTIAL = 0.3;

/** Match every requirement to the features that most likely build it. */
export function matchRequirements(requirements: readonly Requirement[], features: readonly Feature[]): Coverage {
  // Only things people set out to do can build a requirement. Typing in a box or closing a modal
  // doesn't, and their placeholder text ("Loan type, status, month…") would match far too much.
  const flows = features.filter((feature) => feature.entryKind !== 'link');
  const main = flows.filter((feature) => feature.importance !== 'detail');
  const candidates = main.length ? main : flows;
  const words = candidates.map((feature) => new Set(featureWords(feature)));
  // Rare words say more: "beneficiary" pins a feature down, "update" doesn't.
  const weight = (key: string) => {
    // Who does it ("customer", "user") says little about what is built.
    if (ACTORS.has(key)) return 0.6;
    const seen = words.filter((set) => set.has(key)).length;
    // A word no flow has weighs like the rarest word: it is what may be missing ("password").
    return 1 + Math.log(candidates.length / Math.max(1, seen));
  };
  const matches = requirements.map((requirement): RequirementMatch => {
    const keys = keywords(requirement.text);
    const total = keys.reduce((sum, key) => sum + weight(key), 0) || 1;
    const scored = candidates
      .map((feature, index) => {
        const hit = keys.filter((key) => words[index]!.has(key));
        return {
          feature,
          words: hit,
          score: hit.reduce((sum, key) => sum + weight(key), 0) / total,
        };
      })
      .filter((item) => item.words.length >= 1 && item.score > 0.12)
      .sort((a, b) => b.score - a.score);
    const best = scored.slice(0, 3);
    // Words covered by the best few features together: a requirement is often several flows.
    const covered = new Set(best.flatMap((item) => item.words));
    const score = keys.filter((key) => covered.has(key)).reduce((sum, key) => sum + weight(key), 0) / total;
    const status: CoverageStatus = score >= BUILT && (best[0]?.score ?? 0) >= 0.35 ? 'built' : score >= PARTIAL ? 'partial' : 'missing';
    return {
      requirement,
      status,
      score,
      features: status === 'missing' ? best.slice(0, 1).filter((item) => item.score >= 0.2) : best,
      missingWords: keys.filter((key) => !covered.has(key)),
    };
  });
  const built = matches.filter((match) => match.status === 'built').length;
  const partial = matches.filter((match) => match.status === 'partial').length;
  return {
    matches,
    built,
    partial,
    missing: matches.length - built - partial,
    percent: matches.length ? Math.round(((built + partial / 2) / matches.length) * 100) : 0,
  };
}
