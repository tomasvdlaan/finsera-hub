import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';

const SAVE_AFTER_MS = 1200;

/**
 * The note body, autosaved, without losing what you just typed.
 *
 * Notes are taken during a meeting, where remembering to press save is exactly the attention
 * you do not have — so typing is debounced into a write. The complication is that everything
 * else on the page also reloads the note: accepting an action point, adding an attendee, the
 * meeting ending. Each of those replaced the editor's contents with the server's copy, and
 * the server's copy is up to a second and a half out of date.
 *
 * So a reload keeps local text while there are unsaved edits. Getting this wrong is quiet: a
 * sentence disappears as you write it and nothing anywhere reports an error. It mattered
 * little when the editor was one section of a long page and you glanced at it; in a room
 * where the notes are the screen and you type continuously, it would happen daily.
 *
 * Shared by the note page and the room deliberately. Two components owning the same
 * autosave, differently, is how one of them ends up losing text.
 */
export function useNoteBody(noteId: string) {
  const [body, setBody] = useState('');
  const [dirty, setDirty] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Read by `adopt`, which must not depend on a stale render's value. */
  const dirtyRef = useRef(false);

  const setDirtyBoth = (value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  };

  const save = useCallback(
    async (next: string) => {
      await api.patch(`/meetings/${noteId}`, { body: next });
      setDirtyBoth(false);
    },
    [noteId],
  );

  const onChange = useCallback(
    (next: string) => {
      setBody(next);
      setDirtyBoth(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(next).catch(() => undefined), SAVE_AFTER_MS);
    },
    [save],
  );

  /**
   * Take the server's body, unless we are holding something newer.
   *
   * Called on every note refetch. Refusing the update while dirty is the whole point: the
   * debounced write has not landed yet, so the server's copy is behind what is on screen.
   */
  const adopt = useCallback((serverBody: string) => {
    if (dirtyRef.current) return;
    setBody(serverBody);
  }, []);

  /** Write immediately — before doing something that will reload the note. */
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirtyRef.current) return;
    await save(body).catch(() => undefined);
  }, [body, save]);

  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);

  return { body, dirty, onChange, adopt, flush };
}
