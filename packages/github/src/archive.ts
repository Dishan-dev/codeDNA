import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { extract } from 'tar-stream';
import { AcquisitionError } from './index.js';

type Entry = { path: string; sha: string; size: number };
/** Read an untrusted gzip tar in memory, with hard compressed and expanded limits. */
export async function readArchive(
  response: Response,
  entries: readonly Entry[],
  signal: AbortSignal,
): Promise<Map<string, Uint8Array>> {
  if (!response.body)
    throw new AcquisitionError(
      'invalid_response',
      'GitHub returned an empty archive.',
    );
  const expected = new Map(entries.map((entry) => [entry.path, entry]));
  const found = new Map<string, Uint8Array>();
  const seen = new Set<string>();
  let root: string | undefined;
  let count = 0;
  const limited = (max: number) => {
    let bytes = 0;
    return new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        callback(
          bytes > max
            ? new AcquisitionError(
                'limit_exceeded',
                'Repository archive exceeds size limits.',
              )
            : null,
          chunk,
        );
      },
    });
  };
  const parser = extract();
  parser.on('entry', (header, stream, next) => {
    // Destroying the parser also destroys the current entry stream.
    stream.on('error', () => {});
    try {
      if (++count > 100000)
        throw new AcquisitionError(
          'limit_exceeded',
          'Repository archive has too many entries.',
        );
      const raw = header.name.replace(/\/$/, '');
      if (
        !raw ||
        raw.startsWith('/') ||
        raw.includes('\\') ||
        raw.includes('\0') ||
        raw.split('/').some((part) => !part || part === '.' || part === '..')
      )
        throw new AcquisitionError(
          'invalid_response',
          'GitHub returned an unsafe archive path.',
        );
      const parts = raw.split('/');
      if (!root) root = parts[0];
      if (parts[0] !== root)
        throw new AcquisitionError(
          'invalid_response',
          'GitHub returned an invalid archive root.',
        );
      const path = parts.slice(1).join('/');
      if (!path) {
        stream.resume();
        stream.on('end', next);
        return;
      }
      if (seen.has(path))
        throw new AcquisitionError(
          'invalid_response',
          'GitHub returned duplicate archive paths.',
        );
      seen.add(path);
      const item = expected.get(path);
      if (!item) {
        stream.resume();
        stream.on('end', next);
        return;
      }
      if (header.type !== 'file' || header.size !== item.size)
        throw new AcquisitionError(
          'invalid_response',
          'Archive entry does not match the repository tree.',
        );
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > item.size) {
          parser.destroy(
            new AcquisitionError(
              'invalid_response',
              'Archive entry exceeds its declared size.',
            ),
          );
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => {
        const bytes = Buffer.concat(chunks);
        const hash = createHash('sha1')
          .update(`blob ${bytes.length}\0`)
          .update(bytes)
          .digest('hex');
        if (bytes.length !== item.size || hash !== item.sha) {
          parser.destroy(
            new AcquisitionError(
              'invalid_response',
              'Archive file does not match the repository tree.',
            ),
          );
          return;
        }
        found.set(path, bytes);
        next();
      });
    } catch (error) {
      parser.destroy(error as Error);
    }
  });
  try {
    await pipeline(
      Readable.fromWeb(
        response.body as import('node:stream/web').ReadableStream,
      ),
      limited(100 * 1024 * 1024),
      createGunzip(),
      limited(200 * 1024 * 1024),
      parser,
      { signal },
    );
  } catch (error) {
    if (error instanceof AcquisitionError) throw error;
    if (signal.aborted) throw error;
    throw new AcquisitionError(
      'invalid_response',
      'GitHub returned an invalid repository archive.',
    );
  }
  if (found.size !== expected.size)
    throw new AcquisitionError(
      'invalid_response',
      'Repository archive is incomplete.',
    );
  return found;
}
