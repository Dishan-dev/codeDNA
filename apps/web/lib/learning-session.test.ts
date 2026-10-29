import { describe, expect, it } from 'vitest';
import { learningSessionKey } from './explorer-session';
describe('learning session identity', () => {
  it('isolates repository, source, snapshot and revision without collisions', () => {
    const key = learningSessionKey('github', 'owner/repo', 'snapshot', 'sha1');
    expect(learningSessionKey('github', 'owner/repo', 'snapshot', 'sha1')).toBe(
      key,
    );
    expect(
      learningSessionKey('github', 'owner/repo', 'snapshot', 'sha2'),
    ).not.toBe(key);
    expect(
      learningSessionKey('github', 'other/repo', 'snapshot', 'sha1'),
    ).not.toBe(key);
    expect(
      learningSessionKey('sample', 'owner/repo', 'snapshot', 'sha1'),
    ).not.toBe(key);
    expect(
      learningSessionKey('github', 'owner/repo', 'other', 'sha1'),
    ).not.toBe(key);
    expect(learningSessionKey('github', 'owner/repo', 'snapshot')).not.toBe(
      key,
    );
  });
});
