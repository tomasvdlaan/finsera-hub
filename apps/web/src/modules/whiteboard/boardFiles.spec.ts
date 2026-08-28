import { describe, expect, it } from 'vitest';
import { missingFileIds, newFileIds } from './boardFiles.js';
import type { BoardElement } from './types.js';

const image = (id: string, fileId: string, over: Partial<BoardElement> = {}): BoardElement => ({
  id,
  version: 1,
  versionNonce: 1,
  updated: 1,
  type: 'image',
  fileId,
  ...over,
});

describe('newFileIds', () => {
  it('finds a screenshot that has just been pasted', () => {
    const files = { abc: { dataURL: 'data:image/png;base64,AAAA' } };
    expect(newFileIds(files, new Set())).toEqual(['abc']);
  });

  it('ignores one already uploaded', () => {
    const files = { abc: { dataURL: 'data:image/png;base64,AAAA' } };
    // Marked before the request goes out, so onChange firing mid-flight cannot upload the
    // same megabyte three more times.
    expect(newFileIds(files, new Set(['abc']))).toEqual([]);
  });

  it('ignores a file we added from a URL ourselves', () => {
    // These come back from the server as `/api/whiteboard/images/...`. Re-uploading one would
    // store a second copy of bytes we already have, under a new key, for ever.
    const files = { abc: { dataURL: '/api/whiteboard/images/aa/bb.png' } };
    expect(newFileIds(files, new Set())).toEqual([]);
  });

  it('ignores a file with no bytes at all', () => {
    expect(newFileIds({ abc: {} }, new Set())).toEqual([]);
  });
});

describe('missingFileIds', () => {
  it('finds a peer image this browser has no bytes for', () => {
    expect(missingFileIds([image('e1', 'f1')], {}, new Set())).toEqual(['f1']);
  });

  it('ignores one the editor already holds', () => {
    expect(missingFileIds([image('e1', 'f1')], { f1: {} }, new Set())).toEqual([]);
  });

  it('does not ask twice for the same file', () => {
    // onChange fires every frame; without this the same fetch would go out sixty times a
    // second until it landed.
    expect(missingFileIds([image('e1', 'f1')], {}, new Set(['f1']))).toEqual([]);
  });

  it('ignores a deleted image', () => {
    expect(missingFileIds([image('e1', 'f1', { isDeleted: true })], {}, new Set())).toEqual([]);
  });

  it('ignores elements that are not images', () => {
    const rect = { ...image('e1', 'f1'), type: 'rectangle' };
    expect(missingFileIds([rect], {}, new Set())).toEqual([]);
  });

  it('asks once for a file two elements share', () => {
    const both = [image('e1', 'f1'), image('e2', 'f1')];
    expect(missingFileIds(both, {}, new Set())).toEqual(['f1']);
  });
});
