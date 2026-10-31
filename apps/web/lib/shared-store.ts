/** Server-only Upstash REST client. Failures must never weaken admission controls. */
export class SharedStoreError extends Error {
  constructor() {
    super('Shared coordination service unavailable.');
  }
}
export interface SharedStoreConfig {
  url: string;
  token: string;
  fetch?: typeof fetch;
}
export class SharedStore {
  private readonly url: string;
  private readonly fetcher: typeof fetch;
  constructor(private readonly config: SharedStoreConfig) {
    const url = new URL(config.url);
    if (
      url.protocol !== 'https:' ||
      !url.hostname.endsWith('.upstash.io') ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      !config.token
    )
      throw new SharedStoreError();
    this.url = url.origin;
    this.fetcher = config.fetch ?? fetch;
  }
  async command(
    args: (string | number)[],
    signal?: AbortSignal,
  ): Promise<unknown> {
    try {
      const response = await this.fetcher(this.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.any([
          AbortSignal.timeout(3000),
          ...(signal ? [signal] : []),
        ]),
      });
      if (!response.ok) throw new Error();
      const body: unknown = await response.json();
      if (
        !body ||
        typeof body !== 'object' ||
        !('result' in body) ||
        'error' in body
      )
        throw new Error();
      return body.result;
    } catch {
      throw new SharedStoreError();
    }
  }
  async read(key: string): Promise<string | null> {
    const result = await this.command(['GET', key]);
    if (result !== null && typeof result !== 'string')
      throw new SharedStoreError();
    return result;
  }
  async write(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (
      !Number.isSafeInteger(ttlSeconds) ||
      ttlSeconds < 1 ||
      ttlSeconds > 86400 ||
      Buffer.byteLength(value) > 1024 * 1024
    )
      throw new SharedStoreError();
    if ((await this.command(['SET', key, value, 'EX', ttlSeconds])) !== 'OK')
      throw new SharedStoreError();
  }
}
/** Atomic fixed-window admission and global job leases; Redis server time avoids host clock skew. */
const ADMIT_SCRIPT = `
local now = redis.call('TIME')
local ms = now[1] * 1000 + math.floor(now[2] / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ms)
local rate = tonumber(redis.call('GET', KEYS[1]) or '0')
if rate >= tonumber(ARGV[1]) then return 'rate_limited' end
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[2]) then return 'busy' end
rate = redis.call('INCR', KEYS[1])
if rate == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[3]) end
redis.call('ZADD', KEYS[2], ms + tonumber(ARGV[4]), ARGV[5])
redis.call('PEXPIRE', KEYS[2], ARGV[4])
return 'admitted'
`;
export async function admitJob(
  store: SharedStore,
  jobId: string,
): Promise<'admitted' | 'busy' | 'rate_limited'> {
  if (!/^[a-f0-9-]{36}$/.test(jobId)) throw new SharedStoreError();
  const result = await store.command([
    'EVAL',
    ADMIT_SCRIPT,
    2,
    'codedna:admission:rate',
    'codedna:admission:leases',
    30,
    2,
    60000,
    120000,
    jobId,
  ]);
  if (result !== 'admitted' && result !== 'busy' && result !== 'rate_limited')
    throw new SharedStoreError();
  return result;
}
export async function releaseJob(
  store: SharedStore,
  jobId: string,
): Promise<void> {
  if (!/^[a-f0-9-]{36}$/.test(jobId)) throw new SharedStoreError();
  const result = await store.command([
    'ZREM',
    'codedna:admission:leases',
    jobId,
  ]);
  if (result !== 0 && result !== 1) throw new SharedStoreError();
}
