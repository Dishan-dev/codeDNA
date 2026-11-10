import { describe, expect, it } from 'vitest';
import { isOpenPath } from './developer-mode';

describe('developer mode', () => {
  it('keeps only the landing page and its own files open', () => {
    for (const path of ['/', '/developer-mode', '/_next/static/chunks/main.js', '/starters/index.json', '/icon.svg', '/apple-icon']) expect(isOpenPath(path), path).toBe(true);
    for (const path of ['/r/snackshop', '/r/snackshop/learn/place-order', '/explore', '/projects', '/api/github/import', '/api/github/bundle/gh-acme-shop', '/api/x.json']) expect(isOpenPath(path), path).toBe(false);
  });
});
