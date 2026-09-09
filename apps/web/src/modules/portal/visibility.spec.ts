import { describe, expect, it } from 'vitest';
import { savable, summarise, toggleUser, type Visibility } from './visibility.js';

const everyone: Visibility = { mode: 'everyone', userIds: [] };
const names: Record<string, string> = { u1: 'Charlotte', u2: 'Bob' };
const nameOf = (id: string) => names[id] ?? null;

describe('artefact visibility', () => {
  /**
   * The bug this file exists for.
   *
   * A report nobody has restricted starts here, and this is the state somebody is in when they
   * decide one report is not for everyone. If choosing to restrict is refused until a person is
   * ticked, and ticking a person does nothing until the mode is restricted, there is no first
   * move — which is exactly how the first version of this control behaved.
   */
  it('lets a report shared with everyone be restricted, starting from nobody ticked', () => {
    const restricting: Visibility = { ...everyone, mode: 'restricted' };

    // Choosing it is allowed. Storing it is not, yet — that is the whole distinction.
    expect(savable(restricting)).toBe(false);

    const withCharlotte = toggleUser(restricting, 'u1');
    expect(savable(withCharlotte)).toBe(true);
    expect(withCharlotte).toEqual({ mode: 'restricted', userIds: ['u1'] });
  });

  it('never stores a report restricted to nobody', () => {
    // Between unticking the last person and ticking another, the screen is briefly in a state
    // that would hide the report from everybody. It is a draft, not a save.
    expect(savable({ mode: 'restricted', userIds: [] })).toBe(false);
    expect(savable({ mode: 'restricted', userIds: ['u1'] })).toBe(true);
  });

  it('keeps the list when a report goes back to everyone', () => {
    const back: Visibility = { mode: 'everyone', userIds: ['u1', 'u2'] };

    // Saved as it is: restricting it again restores the list somebody built rather than
    // starting from an empty panel.
    expect(savable(back)).toBe(true);
    expect(back.userIds).toEqual(['u1', 'u2']);
  });

  it('adds and removes one person without touching the mode', () => {
    const one: Visibility = { mode: 'restricted', userIds: ['u1'] };
    expect(toggleUser(one, 'u2')).toEqual({ mode: 'restricted', userIds: ['u1', 'u2'] });
    expect(toggleUser(one, 'u1')).toEqual({ mode: 'restricted', userIds: [] });
  });

  it('answers the question outright when one person can see it', () => {
    expect(summarise(everyone, nameOf)).toBe('Everyone');
    expect(summarise({ mode: 'restricted', userIds: ['u1'] }, nameOf)).toBe('Only Charlotte');
    expect(summarise({ mode: 'restricted', userIds: ['u1', 'u2'] }, nameOf)).toBe('Only 2 people');
  });

  it('says something true when the names have not loaded', () => {
    // The people list is fetched only when the panel is opened, so a row can be asked to
    // describe itself before any name is known.
    expect(summarise({ mode: 'restricted', userIds: ['u9'] }, nameOf)).toBe('Only 1 person');
  });
});
