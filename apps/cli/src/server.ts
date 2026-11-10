import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { JourneyEdits, QaLiveRun, RepoBundle } from '@codedna/shared';

export type UiHandler = (request: IncomingMessage, response: ServerResponse) => unknown;
export interface LocalServerOptions {
  bundle: RepoBundle;
  /** Serves the learning UI (the built Next.js app). */
  ui: UiHandler;
  /** First port to try; the next free one is used if it is taken. 0 picks any free port. */
  port?: number;
  /** The project's last `codedna qa` report, read fresh on each request so a new run shows up. */
  qaReportPath?: string;
  /** The project's `.codedna/qa/` folder, where QA screenshots are kept. */
  qaDir?: string;
  /** Runs QA flows when the page asks (the QA flows page's Test buttons). */
  qa?: {
    status: () => QaLiveRun;
    start: (request: unknown) => Promise<string | undefined>;
    stop: () => void;
  };
  /** The project's journey edits and test account, for the QA flows page (with `qa`). */
  project?: {
    read: () => Promise<{ edits?: JourneyEdits; account?: { email: string } }>;
    /** Returns a reason when the value can't be saved. */
    saveJourneys: (value: unknown) => Promise<string | undefined>;
    saveAccount: (value: unknown) => Promise<string | undefined>;
  };
}
export interface LocalServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

const HOST = '127.0.0.1';
const PORT_ATTEMPTS = 20;

/**
 * Only requests addressed to this machine by name are answered. That blocks DNS-rebinding:
 * a web page can't point its own domain at 127.0.0.1 and read the learner's code.
 */
export function allowedHost(header: string | undefined, port: number): boolean {
  return !!header && [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`].includes(header.toLowerCase());
}

function send(response: ServerResponse, status: number, body: string, type = 'application/json; charset=utf-8') {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  response.end(body);
}

const MAX_BODY = 16_000;

function readBody(request: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        resolve(undefined);
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', () => resolve(undefined));
  });
}

const sameToken = (given: string | string[] | undefined, token: string) => typeof given === 'string' && given.length === token.length && timingSafeEqual(Buffer.from(given), Buffer.from(token));

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, HOST);
  });
}

/**
 * A small server on 127.0.0.1 only: the learner's lesson bundle at /api/local/bundle/<id>, and
 * the learning UI for everything else. Nothing is uploaded, and repository code never runs.
 */
export async function startLocalServer({ bundle, ui, port = 3737, qaReportPath, qaDir, qa, project }: LocalServerOptions): Promise<LocalServer> {
  const json = JSON.stringify(bundle);
  let actualPort = port;
  // Starting a run acts on the learner's app, so it needs this page's token as well as the right
  // host: another site can't read it (no CORS), and can't send the header without a preflight.
  const token = randomBytes(24).toString('hex');
  const id = bundle.id.replace(/[^a-z0-9-]/gi, '');
  const ownOrigin = (origin: string | undefined) => !origin || [`http://localhost:${actualPort}`, `http://127.0.0.1:${actualPort}`, `http://[::1]:${actualPort}`].includes(origin.toLowerCase());
  const server = createServer((request, response) => {
    if (!allowedHost(request.headers.host, actualPort)) return send(response, 421, JSON.stringify({ error: 'This server only answers on localhost.' }));
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname.startsWith('/api/local/')) {
      const fromPage = () => sameToken(request.headers['x-codedna-token'], token) && ownOrigin(request.headers.origin) && (!request.headers['sec-fetch-site'] || request.headers['sec-fetch-site'] === 'same-origin');
      if (project && request.method === 'POST' && (pathname === `/api/local/journeys/${id}` || pathname === `/api/local/qa-account/${id}`)) {
        if (!fromPage()) return send(response, 403, JSON.stringify({ error: 'Only the CodeDNA page on this computer can change this.' }));
        if (!/^application\/json\b/i.test(request.headers['content-type'] ?? '')) return send(response, 415, JSON.stringify({ error: 'Send JSON.' }));
        void readBody(request).then(async (body) => {
          let value: unknown;
          try {
            value = JSON.parse(body ?? '');
          } catch {
            return send(response, 400, JSON.stringify({ error: 'Send JSON.' }));
          }
          const save = pathname.startsWith('/api/local/journeys/') ? project.saveJourneys : project.saveAccount;
          const problem = await save(value).catch((error: Error) => error.message);
          return problem ? send(response, 400, JSON.stringify({ error: problem })) : send(response, 200, JSON.stringify(await project.read()));
        });
        return;
      }
      if (qa && request.method === 'POST' && (pathname === `/api/local/qa-run/${id}` || pathname === `/api/local/qa-run/${id}/stop`)) {
        if (!fromPage()) return send(response, 403, JSON.stringify({ error: 'Only the CodeDNA page on this computer can start a run.' }));
        if (pathname.endsWith('/stop')) {
          qa.stop();
          return send(response, 202, JSON.stringify(qa.status()));
        }
        if (!/^application\/json\b/i.test(request.headers['content-type'] ?? '')) return send(response, 415, JSON.stringify({ error: 'Send JSON.' }));
        void readBody(request).then(async (body) => {
          let value: unknown;
          try {
            value = JSON.parse(body ?? '');
          } catch {
            return send(response, 400, JSON.stringify({ error: 'Send { url, mode } as JSON.' }));
          }
          const problem = await qa.start(value).catch((error: Error) => error.message);
          return problem ? send(response, 400, JSON.stringify({ error: problem })) : send(response, 202, JSON.stringify(qa.status()));
        });
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 405, JSON.stringify({ error: 'Read only.' }));
      if (pathname === `/api/local/qa-session/${id}`) return qa ? send(response, 200, JSON.stringify({ token })) : send(response, 404, JSON.stringify({ error: 'Runs start from the terminal here.' }));
      if (pathname === `/api/local/journeys/${id}`) {
        if (!project) return send(response, 404, JSON.stringify({ error: 'No project here.' }));
        void project.read().then((value) => send(response, 200, JSON.stringify(value)));
        return;
      }
      if (pathname === `/api/local/qa-run/${id}`) return qa ? send(response, 200, JSON.stringify(qa.status())) : send(response, 404, JSON.stringify({ error: 'No runs here.' }));
      if (pathname === `/api/local/bundle/${bundle.id}`) return send(response, 200, json);
      // A QA screenshot: only run-folder/file.jpg names, so nothing outside .codedna/qa can be read.
      const shot = new RegExp(`^/api/local/qa-shot/${bundle.id.replace(/[^a-z0-9-]/gi, '')}/(run-\\d{8}-\\d{6})/([a-z0-9-]+\\.jpg)$`, 'i').exec(pathname);
      if (shot) {
        if (!qaDir) return send(response, 404, JSON.stringify({ error: 'No screenshots.' }));
        void readFile(join(qaDir, shot[1]!, shot[2]!)).then(
          (image) => {
            response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
            response.end(image);
          },
          () => send(response, 404, JSON.stringify({ error: 'Screenshot not found.' })),
        );
        return;
      }
      if (pathname === `/api/local/qa/${bundle.id}`) {
        if (!qaReportPath) return send(response, 404, JSON.stringify({ error: 'No QA report.' }));
        void readFile(qaReportPath, 'utf8').then(
          (text) => send(response, 200, text),
          () => send(response, 404, JSON.stringify({ error: 'No QA report yet. Run “codedna qa”.' })),
        );
        return;
      }
      return send(response, 404, JSON.stringify({ error: 'Not found.' }));
    }
    Promise.resolve()
      .then(() => ui(request, response))
      .catch(() => {
        if (!response.headersSent) send(response, 500, 'Something went wrong while showing this page.', 'text/plain; charset=utf-8');
      });
  });

  for (let attempt = 0; ; attempt++) {
    try {
      actualPort = await listen(server, port === 0 ? 0 : port + attempt);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || port === 0 || attempt >= PORT_ATTEMPTS - 1) throw error;
    }
  }
  return {
    url: `http://localhost:${actualPort}`,
    port: actualPort,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
