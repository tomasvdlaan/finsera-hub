/**
 * Slash commands for the note editor.
 *
 * Two constraints shape all of this, both discovered rather than assumed.
 *
 * There is no `@tiptap/suggestion`. It is not installed and `@tiptap/core@3` does not export
 * it, so the trigger below is hand-rolled — in keeping with Dialog and Toast, which are too.
 *
 * And what a command inserts must survive the Markdown serializer. The body round-trips
 * through `getMarkdown()` on every keystroke, so anything the serializer cannot express is
 * deleted on the next autosave — silently, since it is the save that drops it and not the
 * edit. `tiptap-markdown` ships specs for exactly bold, italic, strike, code and link, plus
 * fifteen node types; anything else falls back to writing `[nodeName]` into the document.
 *
 * So commands return ProseMirror node JSON built from nodes the serializer knows, rather than
 * Markdown text. The parser's `insertContentAt` override would parse a Markdown string, but it
 * parses `{ inline: true }`, which is no use for a blockquote or a task item. Building the
 * nodes and letting the serializer write the Markdown is the direction that holds.
 */

/** ProseMirror node JSON. Loosely typed on purpose: TipTap validates it against the schema. */
export type NodeJson = Record<string, unknown>;

export interface SlashCommand {
  /** What you type after the slash. */
  name: string;
  label: string;
  hint: string;
  /**
   * Do the thing, and say what belongs in the document.
   *
   * Returning null inserts nothing — used when the dialog is cancelled, so typing `/ticket`
   * and changing your mind leaves the note as it was rather than a stray heading.
   */
  run: () => Promise<NodeJson | null>;
}

const bold = (text: string) => ({ type: 'text', marks: [{ type: 'bold' }], text });
const plain = (text: string) => ({ type: 'text', text });

/**
 * `> **Label:** text`
 *
 * A blockquote holding one paragraph. Both are stock nodes with serializer specs, so this
 * comes back out of the document as the Markdown above and parses back in as this.
 */
export const calloutNode = (label: string, text: string): NodeJson => ({
  type: 'blockquote',
  content: [
    {
      type: 'paragraph',
      content: [bold(`${label}: `), plain(text)],
    },
  ],
});

/**
 * `- [ ] **Task:** text`
 *
 * A task list with one unchecked item. The checkbox is the point: an action written during a
 * meeting is a thing that is or is not done, and a task item says so in the note as well as
 * on the board.
 */
export const taskNode = (text: string): NodeJson => ({
  type: 'taskList',
  content: [
    {
      type: 'taskItem',
      attrs: { checked: false },
      content: [{ type: 'paragraph', content: [bold('Task: '), plain(text)] }],
    },
  ],
});

/**
 * Where a slash command may start.
 *
 * The block must begin with the slash, which is the rule that makes this predictable: a
 * trigger that fires anywhere would fire inside `https://` and in every file path anyone
 * pastes. The query runs to the cursor and cannot contain a space.
 */
export const SLASH = /^\/(\S*)$/;

export const matching = (commands: SlashCommand[], query: string): SlashCommand[] => {
  const q = query.toLowerCase();
  return commands.filter((c) => c.name.startsWith(q) || c.label.toLowerCase().startsWith(q));
};
