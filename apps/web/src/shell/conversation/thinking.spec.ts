import { describe, expect, it } from 'vitest';
import { latestThought } from './thinking.js';

/**
 * The live line, which is the whole feature: for most of a real answer there is no text yet,
 * and a caret blinking for nine seconds cannot be told apart from a hang.
 */
describe('latestThought', () => {
  it('takes the most recent heading, because that is already the summary', () => {
    const raw =
      '**Defining the Project Scope**\n\nOkay, I need the project id.\n\n' +
      '**Checking What Is Stuck**\n\nNow I will look at the blocked cards.';
    expect(latestThought(raw)).toBe('Checking What Is Stuck');
  });

  it('has nothing to say before anything has arrived', () => {
    expect(latestThought(undefined)).toBeNull();
    expect(latestThought('   ')).toBeNull();
  });

  it('falls back to the last finished sentence when a provider writes no headings', () => {
    // Only a finished one: the trailing fragment changes character by character, and a line
    // that rewrites itself every few milliseconds reads as broken rather than as busy.
    const raw = 'I should find the project. Then I will check the board. Now I am wri';
    expect(latestThought(raw)).toBe('Then I will check the board.');
  });

  it('shows the opening fragment rather than nothing at all', () => {
    // The very first tokens have no sentence end yet, and this is exactly the moment the
    // reader most needs something on screen.
    expect(latestThought('Looking for the project')).toBe('Looking for the project');
  });

  it('keeps it to one line', () => {
    const long = `**${'a'.repeat(200)}**`;
    const out = latestThought(long)!;
    expect(out.length).toBeLessThanOrEqual(90);
    expect(out.endsWith('…')).toBe(true);
  });

  it('strips the markdown rather than printing asterisks at the reader', () => {
    expect(latestThought('**Reading the `board` and *notes***')).toBe('Reading the board and notes');
  });
});
