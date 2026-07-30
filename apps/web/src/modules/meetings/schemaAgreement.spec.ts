import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { CharacterCount, Placeholder, Selection } from '@tiptap/extensions';
import { createLowlight, common } from 'lowlight';
import { Node, Step, Transform, markdownToDoc, noteSchema, replacing } from '@platform/note-doc';
import { CollabExtension } from './collabExtension.js';

/**
 * The browser and the server must agree on what a note is.
 *
 * This is the single assumption the whole collaborative editor rests on. A ProseMirror step
 * is a description of a change at a position in a *particular schema*; the API deserialises
 * the steps this editor sends against its own copy, and if the two schemas differ by one node
 * or one attribute the step either fails to apply or applies to the wrong thing.
 *
 * The failure would not look like a crash. It would look like edits from one person silently
 * not arriving for another, which is indistinguishable from a flaky network and is the last
 * thing anyone would think to check. So it is checked here instead.
 *
 * The editor adds chrome on top — a placeholder, a character count, the collaboration plugin
 * itself. None of it may introduce a node or a mark, and this proves it.
 */
const lowlight = createLowlight(common);

const browserSchema = getSchema([
  ...replacing('codeBlock', CodeBlockLowlight.configure({ lowlight })),
  Placeholder,
  Selection,
  CharacterCount,
  CollabExtension,
]);

describe('the browser and the server agree on the schema', () => {
  it('has the same nodes', () => {
    expect(Object.keys(browserSchema.nodes).sort()).toEqual(Object.keys(noteSchema.nodes).sort());
  });

  it('has the same marks', () => {
    expect(Object.keys(browserSchema.marks).sort()).toEqual(Object.keys(noteSchema.marks).sort());
  });

  it('gives every node the same attributes and content rules', () => {
    for (const [name, node] of Object.entries(browserSchema.nodes)) {
      const theirs = noteSchema.nodes[name]!;
      expect({ name, attrs: Object.keys(node.spec.attrs ?? {}).sort() }).toEqual({
        name,
        attrs: Object.keys(theirs.spec.attrs ?? {}).sort(),
      });
      expect({ name, content: node.spec.content }).toEqual({ name, content: theirs.spec.content });
      expect({ name, group: node.spec.group }).toEqual({ name, group: theirs.spec.group });
      expect({ name, inline: node.isInline }).toEqual({ name, inline: theirs.isInline });
    }
  });

  it('gives every mark the same attributes', () => {
    for (const [name, mark] of Object.entries(browserSchema.marks)) {
      const theirs = noteSchema.marks[name]!;
      expect({ name, attrs: Object.keys(mark.spec.attrs ?? {}).sort() }).toEqual({
        name,
        attrs: Object.keys(theirs.spec.attrs ?? {}).sort(),
      });
    }
  });

  /**
   * The substitution the editor is allowed to make, pinned down.
   *
   * CodeBlockLowlight replaces CodeBlock so that fenced code is syntax-highlighted on screen.
   * It is permitted only because it extends CodeBlock and therefore keeps the node name and
   * attributes; if a future version added one, this is where that would be caught.
   */
  it('keeps codeBlock identical despite the lowlight substitution', () => {
    expect(Object.keys(browserSchema.nodes.codeBlock!.spec.attrs ?? {})).toEqual(
      Object.keys(noteSchema.nodes.codeBlock!.spec.attrs ?? {}),
    );
  });

  /**
   * A step written against one schema must apply against the other.
   *
   * The two schemas are separate objects — one built here by TipTap, one built in the API's
   * process — and ProseMirror compares node types by identity, not by name. So a step has to
   * be deserialised against the schema of the document it is going to be applied to.
   *
   * Getting that wrong is why every incoming change was rejected with "Invalid content for
   * node doc" while the socket, the versions and the broadcast were all working perfectly.
   * There was nothing to see: the note simply stopped receiving other people's edits.
   */
  it('lets a step cross from one schema instance to the other', () => {
    const body = '# Title\n\nA paragraph.\n\n## Section\n\n- a bullet';

    // The server produces a step against its own schema.
    const theirs = new Transform(markdownToDoc(body));
    theirs.insert(theirs.doc.content.size, markdownToDoc('## Added\n\nBy the assistant.').content);
    const wire = theirs.steps.map((s) => s.toJSON());

    // The browser replays it against a document built from *its* schema.
    const mine = Node.fromJSON(browserSchema, markdownToDoc(body).toJSON());
    const replay = new Transform(mine);
    for (const raw of wire) replay.step(Step.fromJSON(browserSchema, raw));

    expect(replay.doc.textContent).toContain('By the assistant.');
    expect(replay.doc.textContent).toContain('A paragraph.');
  });

  it('adds no node or mark for the chrome', () => {
    // Named explicitly so that adding an extension with a node is a decision, not an accident.
    expect(Object.keys(noteSchema.nodes).sort()).toEqual([
      'blockquote',
      'bulletList',
      'codeBlock',
      'doc',
      'hardBreak',
      'heading',
      'horizontalRule',
      'image',
      'listItem',
      'orderedList',
      'paragraph',
      'table',
      'tableCell',
      'tableHeader',
      'tableRow',
      'taskItem',
      'taskList',
      'text',
    ]);
    expect(Object.keys(noteSchema.marks).sort()).toEqual([
      'bold',
      'code',
      'highlight',
      'italic',
      'link',
      'strike',
      // Carries the colour. Markdown cannot express one, so it travels as a narrowly
      // restricted <span> — see markdown/parse.ts for what is and is not accepted back.
      'textStyle',
    ]);
  });
});
