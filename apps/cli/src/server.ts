import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { RepoBundle } from '@codedna/shared';

export type UiHandler = (request: IncomingMessage, response: ServerResponse) => unknown;
export interface LocalServerOptions {
  bundle: RepoBundle;
  /** Serves the learning UI (the built Next.js app). */
  ui: UiHandler;
  /** First port to try; the next free one is used if it is taken. 0 picks any free port. */
  port?: number;
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
export async function startLocalServer({ bundle, ui, port = 3737 }: LocalServerOptions): Promise<LocalServer> {
  const json = JSON.stringify(bundle);
  let actualPort = port;
  const server = createServer((request, response) => {
    if (!allowedHost(request.headers.host, actualPort)) return send(response, 421, JSON.stringify({ error: 'This server only answers on localhost.' }));
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname.startsWith('/api/local/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 405, JSON.stringify({ error: 'Read only.' }));
      if (pathname === `/api/local/bundle/${bundle.id}`) return send(response, 200, json);
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
