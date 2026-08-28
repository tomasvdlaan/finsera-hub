import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardElement } from '@platform/board-doc';
import type { Actor } from '@platform/contracts';
import { BoardDocService, type Persistence } from './board-doc.service.js';

const actor: Actor = { userId: crypto.randomUUID(), role: 'admin' };
const BOARD = 'board-1';

const el = (id: string, version = 1, over: Partial<BoardElement> = {}): BoardElement => ({
  id,
  version,
  versionNonce: 100 + version,
  updated: 1_700_000_000_000,
  type: 'rectangle',
  ...over,
});

/** A persistence seam that records what it was asked to write. */
function fakePersistence(seed: BoardElement[] = []) {
  const saves: Array<{ changed: BoardElement[]; appState: unknown }> = [];
  let fail = false;
  const persistence: Persistence = {
    load: async () => ({ elements: seed, appState: { viewBackgroundColor: '#fff' } }),
    save: async (_boardId, changed, appState) => {
      if (fail) throw new Error('database is on fire');
      saves.push({ changed, appState });
    },
  };
  return {
    persistence,
    saves,
    breakIt: () => {
      fail = true;
    },
    fixIt: () => {
      fail = false;
    },
  };
}

describe('BoardDocService', () => {
  let boards: BoardDocService;

  beforeEach(() => {
    vi.useFakeTimers();
    boards = new BoardDocService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('hydration', () => {
    it('reads the scene once even when two people join at the same moment', async () => {
      let loads = 0;
      boards.bind({
        load: async () => {
          loads++;
          return { elements: [], appState: {} };
        },
        save: async () => undefined,
      });

      await Promise.all([boards.open(BOARD), boards.open(BOARD), boards.open(BOARD)]);
      // Two hydrations would mean two scenes for one board, and half the room drawing on a
      // copy nobody else can see.
      expect(loads).toBe(1);
    });

    it('hands out the stored elements, tombstones included', async () => {
      const { persistence } = fakePersistence([el('a'), el('gone', 2, { isDeleted: true })]);
      boards.bind(persistence);

      const snapshot = await boards.snapshot(BOARD);
      expect(snapshot.elements.map((e) => e.id).sort()).toEqual(['a', 'gone']);
    });
  });

  describe('applying changes', () => {
    it('marks only what it accepted as needing a write', async () => {
      const { persistence, saves } = fakePersistence([el('a', 5)]);
      boards.bind(persistence);

      await boards.apply(BOARD, { elements: [el('a', 2), el('b', 1)], actor, from: 'c1' });
      await vi.advanceTimersByTimeAsync(1_100);

      // 'a' arrived stale and lost; writing it back would undo the newer version.
      expect(saves[0]?.changed.map((e) => e.id)).toEqual(['b']);
    });

    it('tells its listeners only what it accepted', async () => {
      const { persistence } = fakePersistence([el('a', 5)]);
      boards.bind(persistence);
      const heard: string[][] = [];
      boards.onChange((c) => heard.push(c.elements.map((e) => e.id)));

      await boards.apply(BOARD, { elements: [el('a', 2), el('b', 1)], actor, from: 'c1' });

      expect(heard).toEqual([['b']]);
    });

    it('says nothing at all when a whole batch was stale', async () => {
      const { persistence } = fakePersistence([el('a', 5)]);
      boards.bind(persistence);
      const heard: unknown[] = [];
      boards.onChange((c) => heard.push(c));

      const accepted = await boards.apply(BOARD, { elements: [el('a', 2)], actor, from: 'c1' });

      expect(accepted).toEqual([]);
      // A broadcast of nothing is still a message to every peer on the board.
      expect(heard).toHaveLength(0);
    });

    it('survives a listener that throws, so one bad subscriber cannot stop the board', async () => {
      const { persistence } = fakePersistence();
      boards.bind(persistence);
      boards.onChange(() => {
        throw new Error('subscriber exploded');
      });
      const heard: unknown[] = [];
      boards.onChange((c) => heard.push(c));

      await expect(
        boards.apply(BOARD, { elements: [el('a')], actor, from: 'c1' }),
      ).resolves.toHaveLength(1);
      expect(heard).toHaveLength(1);
    });
  });

  describe('flushing', () => {
    it('collects a burst of drawing into one write', async () => {
      const { persistence, saves } = fakePersistence();
      boards.bind(persistence);

      for (let v = 1; v <= 50; v++) {
        await boards.apply(BOARD, { elements: [el('a', v)], actor, from: 'c1' });
        await vi.advanceTimersByTimeAsync(10);
      }
      await vi.advanceTimersByTimeAsync(1_100);

      // Fifty strokes, one row written. This is the whole reason the debounce exists.
      expect(saves).toHaveLength(1);
      expect(saves[0]?.changed).toHaveLength(1);
      expect(saves[0]?.changed[0]?.version).toBe(50);
    });

    it('writes nothing when nothing changed', async () => {
      const { persistence, saves } = fakePersistence();
      boards.bind(persistence);
      await boards.open(BOARD);

      await boards.flush(BOARD);

      expect(saves).toHaveLength(0);
    });

    it('retries after a failed write rather than losing the work', async () => {
      const { persistence, saves, breakIt, fixIt } = fakePersistence();
      boards.bind(persistence);

      breakIt();
      await boards.apply(BOARD, { elements: [el('a')], actor, from: 'c1' });
      await expect(boards.flush(BOARD)).rejects.toThrow(/on fire/);

      fixIt();
      await boards.flush(BOARD);

      expect(saves[0]?.changed.map((e) => e.id)).toEqual(['a']);
    });

    it('does not lose an element drawn while a failing write was in flight', async () => {
      const saves: Array<{ changed: BoardElement[]; appState: unknown }> = [];
      let failNext = true;
      let inFlight: (() => void) | undefined;

      boards.bind({
        load: async () => ({ elements: [], appState: {} }),
        save: async (_id, changed, appState) => {
          // Draw something new while this write is still awaiting.
          inFlight?.();
          if (failNext) {
            failNext = false;
            throw new Error('transient');
          }
          saves.push({ changed, appState });
        },
      });

      await boards.apply(BOARD, { elements: [el('a')], actor, from: 'c1' });
      inFlight = () => {
        void boards.apply(BOARD, { elements: [el('b')], actor, from: 'c1' });
      };

      await expect(boards.flush(BOARD)).rejects.toThrow(/transient/);
      inFlight = undefined;
      await boards.flush(BOARD);

      // 'b' went dirty DURING the failed write. Restoring the old id list by assignment
      // rather than by union would have dropped it silently.
      expect(saves[0]?.changed.map((e) => e.id).sort()).toEqual(['a', 'b']);
    });

    it('writes appState only when it actually changed', async () => {
      const { persistence, saves } = fakePersistence();
      boards.bind(persistence);

      await boards.apply(BOARD, { elements: [el('a')], actor, from: 'c1' });
      await vi.advanceTimersByTimeAsync(1_100);
      expect(saves[0]?.appState).toBeUndefined();

      await boards.setAppState(BOARD, { viewBackgroundColor: '#000' }, actor);
      await vi.advanceTimersByTimeAsync(1_100);
      expect(saves[1]?.appState).toMatchObject({ viewBackgroundColor: '#000' });
    });
  });

  describe('letting boards go', () => {
    it('drops a board nobody holds once it has been quiet', async () => {
      const { persistence } = fakePersistence();
      boards.bind(persistence);
      await boards.open(BOARD);
      await boards.apply(BOARD, { elements: [el('a')], actor, from: 'c1' });
      await vi.advanceTimersByTimeAsync(1_100);

      boards.sweep(Date.now() + 6 * 60_000);

      let loads = 0;
      boards.bind({
        load: async () => {
          loads++;
          return { elements: [], appState: {} };
        },
        save: async () => undefined,
      });
      await boards.open(BOARD);
      expect(loads).toBe(1);
    });

    it('keeps a board somebody still has open', async () => {
      const { persistence } = fakePersistence([el('a')]);
      boards.bind(persistence);
      await boards.open(BOARD);
      boards.watch(BOARD);

      boards.sweep(Date.now() + 6 * 60_000);

      const snapshot = await boards.snapshot(BOARD);
      expect(snapshot.elements).toHaveLength(1);
    });

    it('keeps a board with unsaved work, however quiet it has been', async () => {
      const { persistence, breakIt } = fakePersistence();
      boards.bind(persistence);
      breakIt();
      await boards.apply(BOARD, { elements: [el('a')], actor, from: 'c1' });
      await boards.flush(BOARD).catch(() => undefined);

      // Dropping it here would throw away the only copy of that drawing.
      boards.sweep(Date.now() + 6 * 60_000);

      const snapshot = await boards.snapshot(BOARD);
      expect(snapshot.elements.map((e) => e.id)).toEqual(['a']);
    });

    it('flushes before releasing', async () => {
      const { persistence, saves } = fakePersistence();
      boards.bind(persistence);
      await boards.apply(BOARD, { elements: [el('a')], actor, from: 'c1' });

      await boards.release(BOARD);

      expect(saves[0]?.changed.map((e) => e.id)).toEqual(['a']);
    });

    it('flushes every open board on shutdown', async () => {
      const { persistence, saves } = fakePersistence();
      boards.bind(persistence);
      await boards.apply('b1', { elements: [el('a')], actor, from: 'c1' });
      await boards.apply('b2', { elements: [el('b')], actor, from: 'c1' });

      await boards.onModuleDestroy();

      expect(saves).toHaveLength(2);
    });
  });
});
