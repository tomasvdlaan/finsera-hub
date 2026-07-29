import { useCallback, useEffect, useRef } from 'react';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
// v3 ships all four table nodes from one package, with named exports only.
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';

/** tiptap-markdown adds this to storage at runtime; it is not in TipTap's own types. */
type MarkdownStorage = { markdown: { getMarkdown(): string } };
const markdownOf = (editor: Editor) =>
  (editor.storage as unknown as MarkdownStorage).markdown.getMarkdown();

/**
 * The note editor.
 *
 * WYSIWYG on the surface, Markdown underneath. That combination is deliberate: the model
 * writes notes into the same document during a meeting, and a model produces correct
 * Markdown far more reliably than it produces editor JSON. It also keeps the document
 * greppable, diffable and indexable by the knowledge layer, and means nothing already
 * written needs converting.
 *
 * Content is parsed into TipTap's schema rather than injected as HTML, so anything the
 * schema does not recognise is dropped. That matters here more than in a normal editor:
 * note bodies are partly written from meeting transcripts, which the AI plan treats as
 * untrusted input.
 */
export function RichEditor({
  markdown,
  onChange,
  editable = true,
}: {
  markdown: string;
  onChange?: (markdown: string) => void;
  editable?: boolean;
}) {
  /** Set while writing external content in, so the change handler does not echo it back. */
  const applying = useRef(false);

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Highlight,
      Link.configure({ openOnClick: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ html: false, transformPastedText: true }),
    ],
    content: markdown,
    onUpdate: ({ editor: instance }) => {
      if (applying.current) return;
      onChange?.(markdownOf(instance));
    },
  });

  /**
   * Take in content written elsewhere — by the note-taking behaviour, mid-meeting.
   *
   * Only applied when it genuinely differs from what is on screen, or every keystroke
   * would rewrite the document and put the cursor back at the start.
   */
  useEffect(() => {
    if (!editor) return;
    const current = markdownOf(editor);
    if (current.trim() === markdown.trim()) return;

    applying.current = true;
    const { from, to } = editor.state.selection;
    editor.commands.setContent(markdown, { emitUpdate: false });
    // Put the cursor back where it was, so notes appearing does not interrupt typing.
    try {
      editor.commands.setTextSelection({ from, to });
    } catch {
      /* the document shrank past the old position; leaving the cursor is fine */
    }
    applying.current = false;
  }, [markdown, editor]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  if (!editor) return <p className="muted">Loading the editor…</p>;

  return (
    <div className="rich-editor">
      {editable && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const chain = useCallback(() => editor.chain().focus(), [editor]);

  const Button = ({
    label,
    title,
    active,
    onClick,
  }: {
    label: string;
    title: string;
    active?: boolean;
    onClick: () => void;
  }) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={active ? 'toolbar-on' : undefined}
      onClick={onClick}
    >
      {label}
    </button>
  );

  return (
    <div className="editor-toolbar">
      <Button label="H1" title="Heading 1" active={editor.isActive('heading', { level: 1 })}
        onClick={() => chain().toggleHeading({ level: 1 }).run()} />
      <Button label="H2" title="Heading 2" active={editor.isActive('heading', { level: 2 })}
        onClick={() => chain().toggleHeading({ level: 2 }).run()} />
      <Button label="H3" title="Heading 3" active={editor.isActive('heading', { level: 3 })}
        onClick={() => chain().toggleHeading({ level: 3 }).run()} />
      <span className="toolbar-sep" />
      <Button label="B" title="Bold" active={editor.isActive('bold')}
        onClick={() => chain().toggleBold().run()} />
      <Button label="I" title="Italic" active={editor.isActive('italic')}
        onClick={() => chain().toggleItalic().run()} />
      <Button label="S" title="Strikethrough" active={editor.isActive('strike')}
        onClick={() => chain().toggleStrike().run()} />
      <Button label="◼" title="Highlight" active={editor.isActive('highlight')}
        onClick={() => chain().toggleHighlight().run()} />
      <Button label="‹›" title="Code" active={editor.isActive('code')}
        onClick={() => chain().toggleCode().run()} />
      <span className="toolbar-sep" />
      <Button label="•" title="Bullet list" active={editor.isActive('bulletList')}
        onClick={() => chain().toggleBulletList().run()} />
      <Button label="1." title="Numbered list" active={editor.isActive('orderedList')}
        onClick={() => chain().toggleOrderedList().run()} />
      <Button label="☑" title="Task list" active={editor.isActive('taskList')}
        onClick={() => chain().toggleTaskList().run()} />
      <Button label="❝" title="Quote" active={editor.isActive('blockquote')}
        onClick={() => chain().toggleBlockquote().run()} />
      <span className="toolbar-sep" />
      <Button label="▦" title="Insert table"
        onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
      <Button label="🔗" title="Link"
        onClick={() => {
          const url = window.prompt('Link to where?', editor.getAttributes('link').href ?? 'https://');
          if (url === null) return;
          if (!url.trim()) return chain().unsetLink().run();
          chain().setLink({ href: url.trim() }).run();
        }} />
      <span className="toolbar-sep" />
      <Button label="↶" title="Undo" onClick={() => chain().undo().run()} />
      <Button label="↷" title="Redo" onClick={() => chain().redo().run()} />
    </div>
  );
}
