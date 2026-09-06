import { describe, expect, it } from 'vitest';
import { compare, label, type ServerBuild } from './build.js';

const server = (over: Partial<ServerBuild> = {}): ServerBuild => ({
  status: 'ok', version: '128', commit: 'abc1234', builtAt: null, ...over,
});

/**
 * The comparison exists to catch the confusion after a deploy: the server is new and the tab
 * the person is looking at is old, and every symptom of that looks like a broken feature.
 */
describe('compare', () => {
  it('says nothing when the server has not answered yet', () => {
    expect(compare(null)).toBe('unknown');
  });

  it('holds its tongue in development, where there is nothing to compare', () => {
    // Otherwise every developer sees "out of date" permanently, and learns to ignore it —
    // which is the same as not having the warning at the moment it finally matters.
    expect(compare(server({ commit: 'dev' }))).toBe('unknown');
  });

  it('agrees when the bundle and the server are the same commit', () => {
    expect(compare(server(), { commit: 'abc1234' })).toBe('match');
  });

  it('calls the open tab stale when the server has moved on', () => {
    // The deploy landed, the tab did not reload. This is the case worth catching.
    expect(compare(server({ commit: 'def5678' }), { commit: 'abc1234' })).toBe('stale');
  });

  it('is the commit that decides, not the number', () => {
    // A rollback redeploys an older commit, so the count goes down while the bundle is
    // still correct for it. Only the commit answers "am I running this code".
    expect(compare(server({ version: '9' }), { commit: 'abc1234' })).toBe('match');
  });
});

describe('label', () => {
  it('reads as a build', () => {
    expect(label({ version: '128', commit: 'abc1234' })).toBe('v128 · abc1234');
  });

  it('does not dress a local build up as a release', () => {
    expect(label({ version: 'dev', commit: 'dev' })).toBe('dev build');
  });
});
