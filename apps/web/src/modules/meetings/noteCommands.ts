/**
 * The things you insert into a note that also do something.
 *
 * These were slash commands, typed as `/ticket` into the body. They are now buttons on the
 * toolbar, because the editor reads as a document rather than a Notion page — but what they
 * do is unchanged and it is the part that matters: writing "Mike is blocked on the compliance
 * sign-off" should put a blocker on the card, not only in a paragraph nobody re-reads.
 *
 * One constraint still shapes them, and it is the reason they return nodes rather than text:
 * what a command inserts has to survive the Markdown serializer. The body is stored as
 * Markdown, so anything the serializer cannot express is lost on the next save — silently,
 * since it is the save that drops it and not the edit. Every node below is one the serializer
 * has a spec for, so it comes back out as the Markdown shown and parses back in as this.
 */

/** ProseMirror node JSON. Loosely typed on purpose: TipTap validates it against the schema. */
export type NodeJson = Record<string, unknown>;

export interface NoteCommand {
  /** Stable identifier, used as the React key. */
  name: string;
  label: string;
  hint: string;
  /**
   * Do the thing, and say what belongs in the document.
   *
   * Returning null inserts nothing — the cancel path, so opening the dialog and changing your
   * mind leaves the note exactly as it was.
   */
  run: () => Promise<NodeJson | null>;
}

const bold = (text: string) => ({ type: 'text', marks: [{ type: 'bold' }], text });
const plain = (text: string) => ({ type: 'text', text });

/**
 * `> **Label:** text`
 *
 * A blockquote holding one paragraph. Both are stock nodes with serializer specs.
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
