import { describe, expect, it } from 'vitest';
import { safeStorageKey } from './storage-key.js';

describe('safeStorageKey', () => {
  it('accepts the shape storage actually produces', () => {
    expect(safeStorageKey('a3/a3f19c2e-4b21-4d51-9c66-0f2b2f0b9a11.png')).toBe(
      'a3/a3f19c2e-4b21-4d51-9c66-0f2b2f0b9a11.png',
    );
  });

  it('joins a wildcard path back together', () => {
    expect(safeStorageKey(['a3', 'image.png'])).toBe('a3/image.png');
  });

  it('refuses traversal', () => {
    // Without this, the endpoint reads anything the process can.
    expect(() => safeStorageKey('../../etc/passwd')).toThrow(/Bad image key/);
    expect(() => safeStorageKey('a3/../../../etc/passwd')).toThrow(/Bad image key/);
  });

  it('refuses traversal that is only visible once decoded', () => {
    expect(() => safeStorageKey('..%2F..%2Fetc%2Fpasswd')).toThrow(/Bad image key/);
  });

  it('refuses an absolute path', () => {
    expect(() => safeStorageKey('/etc/passwd')).toThrow(/Bad image key/);
  });

  it('refuses backslashes, which some filesystems treat as separators', () => {
    expect(() => safeStorageKey('a3\\\\..\\\\secret')).toThrow(/Bad image key/);
  });

  it('refuses an empty key', () => {
    expect(() => safeStorageKey('')).toThrow(/Bad image key/);
  });
});
