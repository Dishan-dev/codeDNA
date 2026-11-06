import type { Concept, ConceptId } from '@codedna/shared';

/**
 * The MVP concept catalog. Written by people for beginners: short sentences, and every term
 * explained the first time it appears. Order is the teaching order (simplest first).
 */
export const CONCEPTS: Record<ConceptId, Concept> = {
  component: {
    id: 'component',
    name: 'Component',
    oneLiner: 'A reusable piece of the screen, written as a function.',
    explainer:
      'A component is a function that returns what should appear on the screen. React apps are built from many small components, like LEGO bricks. A button, a form or a whole page can each be a component. You use one by writing its name like a tag, for example <OrderForm />.',
    whyItMatters: 'When you know which component draws a part of the screen, you know which file to open to change it.',
    level: 1,
    prerequisites: [],
  },
  props: {
    id: 'props',
    name: 'Props',
    oneLiner: 'Values a component receives from the component that uses it.',
    explainer:
      'Props are like the settings you pass to a component. The parent writes them as attributes, for example <FavoriteButton productId="chips" />, and the component reads them as an object. A component cannot change its own props; they always come from outside.',
    whyItMatters: 'Props are how one piece of the screen tells another what to show or which item it is about.',
    level: 1,
    prerequisites: ['component'],
  },
  state: {
    id: 'state',
    name: 'State',
    oneLiner: 'Data a component remembers, which redraws the screen when it changes.',
    explainer:
      'State is a value a component keeps between redraws, created with useState. You get the current value and a setter function, like [query, setQuery]. Calling the setter stores a new value, and React redraws everything that shows it. That is why typing in a box can update the page straight away.',
    whyItMatters: 'Most “the screen didn’t update” bugs come from changing data without going through state.',
    level: 1,
    prerequisites: ['component'],
  },
  'event-handler': {
    id: 'event-handler',
    name: 'Event handler',
    oneLiner: 'A function that runs when the user does something, like click or type.',
    explainer:
      'An event is something the user does: a click, a key press, sending a form. An event handler is the function you connect to it, for example onClick={applyCoupon}. The browser calls it for you at the right moment. Every feature in an app starts with an event like this.',
    whyItMatters: 'Finding the handler is the fastest way to find the code behind any button.',
    level: 1,
    prerequisites: ['component'],
  },
  'conditional-rendering': {
    id: 'conditional-rendering',
    name: 'Conditional rendering',
    oneLiner: 'Showing something on the screen only when a condition is true.',
    explainer:
      'Sometimes a part of the screen should only appear in certain cases, like an error message. React code often writes this as {error && <p>{error}</p>}: if error has a value, the message is shown; if not, nothing is. A question mark version, a ? b : c, picks between two things to show.',
    whyItMatters: 'It explains why some messages and buttons appear only at certain moments.',
    level: 2,
    prerequisites: ['state'],
  },
  'async-await': {
    id: 'async-await',
    name: 'async / await',
    oneLiner: 'Waiting for slow work, like the network or a database, before moving on.',
    explainer:
      'Some work takes time: asking a server, reading a database. A function marked async can use await to pause until that work is done, then continue with the result. Without await, the code would move on while the answer is still on its way.',
    whyItMatters: 'A missing await is one of the most common reasons data “isn’t there yet”.',
    level: 2,
    prerequisites: ['event-handler'],
  },
  'api-call': {
    id: 'api-call',
    name: 'API call',
    oneLiner: 'Asking a server for something over the network.',
    explainer:
      'An API call sends a request to a web address and gets an answer back, often as JSON data. In the browser this is usually done with fetch. The request says what it wants with a method: GET to read, POST to send something new. The server code at that address decides the answer.',
    whyItMatters: 'Most apps are a screen in the browser talking to code on a server. API calls are that conversation.',
    level: 2,
    prerequisites: ['async-await'],
  },
  'server-action': {
    id: 'server-action',
    name: 'Server code',
    oneLiner: 'Code that runs on the server, not in the user’s browser.',
    explainer:
      'Some code must run on the server, where it can use the database and secret keys safely. In Next.js you can write it as a server action (a function in a file that starts with \'use server\') or as an API route (a route.ts file). The browser sends a request, the server runs the code, and the result comes back.',
    whyItMatters: 'Knowing which side code runs on tells you what it can safely do and who can see it.',
    level: 2,
    prerequisites: ['event-handler'],
  },
  validation: {
    id: 'validation',
    name: 'Validation',
    oneLiner: 'Checking that data looks right before using it.',
    explainer:
      'Anything sent from a browser can be wrong or missing, by accident or on purpose. Validation checks the data first, for example that a quantity is a number above zero. Libraries like zod describe the expected shape once, then check data against it. If the check fails, the code stops and explains what is wrong.',
    whyItMatters: 'Without validation, bad data reaches the database and breaks things later in confusing ways.',
    level: 2,
    prerequisites: ['server-action'],
  },
  authentication: {
    id: 'authentication',
    name: 'Sign-in check',
    oneLiner: 'Finding out who the user is before letting them do something.',
    explainer:
      'Authentication means checking who is making a request, usually with a session cookie the browser sends along. Server code reads it, finds the signed-in user, and stops early if there is none, often by sending them to a login page. Every action that changes someone’s data should do this check on the server.',
    whyItMatters: 'A missing sign-in check can let anyone change data that should be private.',
    level: 3,
    prerequisites: ['server-action'],
  },
  database: {
    id: 'database',
    name: 'Database',
    oneLiner: 'Where the app keeps data so it is still there tomorrow.',
    explainer:
      'A database stores the app’s data, like orders or users, in tables. Code reads from it to show things and writes to it to save changes. Tools like Prisma let you write prisma.order.create(…) instead of database commands. Reads and writes happen on the server, never directly from the browser.',
    whyItMatters: 'Knowing what is saved, and when, is knowing what the app really does.',
    level: 2,
    prerequisites: ['server-action'],
  },
  navigation: {
    id: 'navigation',
    name: 'Navigation',
    oneLiner: 'Moving the user to another page.',
    explainer:
      'Navigation is how an app moves you between pages. A <Link> moves when you click it. Code can also move you: redirect(\'/login\') on the server, or router.push(\'/done\') in the browser. After a redirect, the code below it does not run.',
    whyItMatters: 'Many features end by sending you somewhere; it is how the app says “done” or “not allowed”.',
    level: 1,
    prerequisites: [],
  },
};

export const CONCEPT_ORDER: readonly ConceptId[] = Object.keys(CONCEPTS) as ConceptId[];
