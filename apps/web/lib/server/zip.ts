import { inflateRawSync } from 'node:zlib';

/** One file inside a zip, read from the central directory. */
export interface ZipEntry {
  name: string;
  size: number;
  read: () => Buffer;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/**
 * Lists the files in a zip held in memory (GitHub Actions artifacts). Only "stored" and
 * "deflate" entries are read, each capped at `maxEntrySize` so a zip bomb can't fill memory.
 * Zip64 archives (over 4 GB) are refused.
 */
export function readZip(zip: Buffer, maxEntrySize: number): ZipEntry[] {
  let end = -1;
  for (let offset = zip.length - 22; offset >= Math.max(0, zip.length - 22 - 0xffff); offset -= 1) {
    if (zip.readUInt32LE(offset) === EOCD) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error('Not a zip file.');
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== CENTRAL) throw new Error('Broken zip file.');
    const method = zip.readUInt16LE(offset + 10);
    const compressed = zip.readUInt32LE(offset + 20);
    const size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    offset += 46 + nameLength + extraLength + commentLength;
    if (compressed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) throw new Error('Zip64 files are not supported.');
    if (name.endsWith('/')) continue;
    entries.push({
      name,
      size,
      read: () => {
        if (size > maxEntrySize) throw new Error(`${name} is too big.`);
        if (local + 30 > zip.length || zip.readUInt32LE(local) !== LOCAL) throw new Error('Broken zip file.');
        const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
        if (start + compressed > zip.length) throw new Error('Broken zip file.');
        const data = zip.subarray(start, start + compressed);
        if (method === 0) return Buffer.from(data);
        if (method === 8) return inflateRawSync(data, { maxOutputLength: maxEntrySize });
        throw new Error(`${name} uses an unsupported compression.`);
      },
    });
  }
  return entries;
}
