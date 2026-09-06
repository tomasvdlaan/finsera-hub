import { describe, expect, it } from 'vitest';
import { buildInfo } from './build-info.js';

/**
 * The stamp is only useful if an unstamped build says so.
 *
 * A build that reports `v0` when nobody told it its version is worse than one that reports
 * nothing: `0` is a number somebody will compare against, and it will agree with the next
 * unstamped build, which is exactly the false "up to date" this exists to prevent.
 */
describe('buildInfo', () => {
  it('reads what the deploy stamped it with', () => {
    expect(
      buildInfo({ BUILD_VERSION: '254', BUILD_COMMIT: 'e6faf5e', BUILD_TIME: '2026-09-06T16:20:00Z' }),
    ).toEqual({ version: '254', commit: 'e6faf5e', builtAt: '2026-09-06T16:20:00Z' });
  });

  it('says dev rather than inventing a version', () => {
    expect(buildInfo({})).toEqual({ version: 'dev', commit: 'dev', builtAt: null });
  });

  it('treats an empty variable as unset', () => {
    // Compose writes `BUILD_TIME: ${BUILD_TIME:-}`, so an unset stamp arrives as "" rather
    // than as absent — and `builtAt: ""` would render as a blank date in the interface.
    expect(buildInfo({ BUILD_VERSION: '', BUILD_COMMIT: '', BUILD_TIME: '' })).toEqual({
      version: 'dev',
      commit: 'dev',
      builtAt: null,
    });
  });
});
