import { describe, expect, it, vi } from 'vitest';
import {
  SharedStore,
  SharedStoreError,
  admitJob,
  releaseJob,
} from './shared-store';
describe('shared store security', () => {
  it('sends bounded server-side requests without following redirects', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ result: 'OK' }),
    );
    const store = new SharedStore({
      url: 'https://test.upstash.io',
      token: 'private-token',
      fetch: fetcher,
    });
    await store.write('key', 'value', 60);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      redirect: 'error',
      cache: 'no-store',
      headers: { Authorization: 'Bearer private-token' },
    });
  });
  it('rejects unsafe endpoints and sanitized failures', async () => {
    expect(
      () => new SharedStore({ url: 'https://evil.test', token: 'secret' }),
    ).toThrow(SharedStoreError);
    const store = new SharedStore({
      url: 'https://test.upstash.io',
      token: 'secret',
      fetch: async () => {
        throw new Error('secret');
      },
    });
    await expect(store.read('x')).rejects.toThrow(
      'Shared coordination service unavailable.',
    );
    await expect(store.write('key', 'x', 0)).rejects.toThrow(SharedStoreError);
  });
  it('uses atomic shared admission and releases only its lease', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ result: 'admitted' }))
      .mockResolvedValueOnce(Response.json({ result: 1 }));
    const store = new SharedStore({
      url: 'https://test.upstash.io',
      token: 'private-token',
      fetch: fetcher,
    });
    const id = '12345678-1234-1234-1234-123456789abc';
    expect(await admitJob(store, id)).toBe('admitted');
    await releaseJob(store, id);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))[0]).toBe(
      'EVAL',
    );
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual([
      'ZREM',
      'codedna:admission:leases',
      id,
    ]);
    await expect(admitJob(store, 'unsafe')).rejects.toThrow(SharedStoreError);
  });
});
