import { describe, expect, it } from 'vitest';
import { validateRepositoryUrl } from './repository-url';
describe('repository URL validation', () => {
  it('accepts a repository URL and rejects incomplete or unsafe input', () => {
    expect(validateRepositoryUrl('https://github.com/owner/repo')).toBeNull();
    expect(validateRepositoryUrl('')).toMatch(/Enter/);
    for (const input of [
      'github.com/owner/repo',
      'https://github.com/owner',
      'https://github.com.evil.test/a/b',
      'https://user@github.com/a/b',
      'https://github.com/a/b?x=1',
    ])
      expect(validateRepositoryUrl(input)).not.toBeNull();
  });
});
