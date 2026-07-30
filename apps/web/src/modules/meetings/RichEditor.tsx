import { useCallback, useEffect, useRef, useState } from 'react';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
// v3 ships all four table nodes from one package, with named exports only.
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { api } from '../../lib/api.js';
import { useDialog } from '../../shell/ui/Dialog.js';
import { SLASH, matching, type NodeJson, type SlashCommand } from './slashCommands.js';

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
  slashCommands = [],
}: {
  markdown: string;
  onChange?: (markdown: string) => void;
  editable?: boolean;
  /** Typed as `/name`. See slashCommands.ts for why they return nodes and not Markdown. */
  slashCommands?: SlashCommand[];
}) {
  /** Set while writing external content in, so the change handler does not echo it back. */
  const applying = useRef(false);
  /** Paste and drop handlers are created before the editor exists, so they read it here. */
  const editorRef = useRef<Editor | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  /*
   * The open slash menu, if any.
   *
   * `from` is where the slash sits, so selecting a command can delete what was typed. The
   * commands themselves are read through a ref because useEditor captures its options once —
   * a handler closing over the prop would keep calling the first render's version, which for
   * commands closing over a note id means acting on the wrong meeting.
   */
  const [slash, setSlash] = useState<{ query: string; from: number; to: number } | null>(null);
  const [picked, setPicked] = useState(0);
  const commandsRef = useRef(slashCommands);
  commandsRef.current = slashCommands;
  const slashRef = useRef(slash);
  slashRef.current = slash;

  const options = slash ? matching(commandsRef.current, slash.query) : [];
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Highlight,
      // Markdown carries images as ![alt](url), so they survive the round trip.
      Image.configure({ inline: false, allowBase64: false }),
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

      /*
       * Look for `/query` at the start of the block the cursor is in.
       *
       * Recomputed from the document rather than tracked as the user types, so it stays right
       * through undo, paste and clicking elsewhere — the three things that make a
       * keystroke-counting trigger drift out of step with the text on screen.
       */
      if (commandsRef.current.length === 0) return;
      const { $from, empty } = instance.state.selection;
      if (!empty) return setSlash(null);
      const blockStart = $from.start();
      const before = instance.state.doc.textBetween(blockStart, $from.pos, '\n', '\0');
      const found = SLASH.exec(before);
      if (!found) return setSlash(null);
      setSlash({ query: found[1] ?? '', from: blockStart, to: $from.pos });
      setPicked(0);
    },
    editorProps: {
      /**
       * The slash menu's keys, taken before the editor sees them.
       *
       * Only while the menu is open, so arrows and Enter behave normally the rest of the time.
       */
      handleKeyDown: (_view, event) => {
        const open = slashRef.current;
        const choices = optionsRef.current;
        if (!open || choices.length === 0) return false;

        if (event.key === 'Escape') {
          setSlash(null);
          return true;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const step = event.key === 'ArrowDown' ? 1 : -1;
          setPicked((i) => (i + step + choices.length) % choices.length);
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const chosen = choices[Math.min(picked, choices.length - 1)];
          if (chosen) void pick(chosen);
          return true;
        }
        return false;
      },

      /**
       * Paste an image straight into the note.
       *
       * The common case by a distance: a screenshot of a dashboard, pasted mid-sentence.
       * Base64 in the document is refused — it would bloat every note and break the
       * knowledge layer's chunking — so the bytes are uploaded and a URL inserted.
       */
      handlePaste: (_view, event) => {
        const files = imageFilesFrom(event.clipboardData);
        if (files.length === 0) return false;
        event.preventDefault();
        void uploadAll(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = imageFilesFrom((event as DragEvent).dataTransfer);
        if (files.length === 0) return false;
        event.preventDefault();
        void uploadAll(files);
        return true;
      },
    },
  });

  /**
   * Run a command and put what it returns in the document.
   *
   * The typed `/query` is deleted first, and only then is the command run — so a dialog opens
   * over a note that already looks finished, and cancelling leaves no debris. If the command
   * returns null nothing is inserted, which is the cancel path.
   */
  const pick = useCallback(async (command: SlashCommand) => {
    const open = slashRef.current;
    const instance = editorRef.current;
    setSlash(null);
    if (!open || !instance) return;

    instance.chain().focus().deleteRange({ from: open.from, to: open.to }).run();

    let node: NodeJson | null;
    try {
      node = await command.run();
    } catch (error) {
      setUploadError((error as Error).message);
      return;
    }
    if (!node) return;

    /*
     * Always at the top level, never at the caret's depth.
     *
     * Pressing Enter at the end of a quote continues the quote, so a caret can easily be two
     * or three levels down — and inserting a block node there nests it. A task list inside a
     * blockquote serialises to nested Markdown that does not survive being read back: the
     * observed damage was a neighbouring `**Decision:**` coming out as `****Decision:**`,
     * which is silent, permanent, and lands in the note body rather than anywhere visible.
     *
     * So the insertion point is after whichever top-level block the caret is inside. A
     * callout or a task written during a meeting is its own paragraph anyway.
     */
    const { $from } = instance.state.selection;
    const at = $from.depth > 1 ? $from.after(1) : undefined;

    // `insertContent`, not `insertContentAt`: the Markdown extension overrides the latter to
    // parse its argument as a Markdown string, which is no use for node JSON.
    const chain = instance.chain().focus();
    if (at !== undefined) chain.setTextSelection(at);
    chain.insertContent(node).run();
  }, []);

  /** Upload, then insert — sequentially, so several pasted images keep their order. */
  const uploadAll = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        try {
          const url = await uploadImage(file);
          editorRef.current?.chain().focus().setImage({ src: url, alt: file.name }).run();
        } catch (error) {
          setUploadError((error as Error).message);
        }
      }
    },
    [],
  );

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
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  if (!editor) return <p className="muted">Loading the editor…</p>;

  return (
    <div className="rich-editor">
      {editable && <Toolbar editor={editor} onUpload={uploadAll} />}
      <EditorContent editor={editor} />

      {/*
        In the flow rather than floating over the caret.

        A popover positioned from coordsAtPos is the usual approach and needs scroll listeners,
        a resize observer and clamping to the viewport to stop it hanging off the bottom of the
        room. This sits under the editor: less clever, always in the right place, and it cannot
        cover the sentence you are writing.
      */}
      {options.length > 0 && (
        <div className="slash-menu" role="listbox" aria-label="Insert">
          {options.map((c, i) => (
            <button
              key={c.name}
              role="option"
              aria-selected={i === Math.min(picked, options.length - 1)}
              className={
                i === Math.min(picked, options.length - 1) ? 'slash-item slash-on' : 'slash-item'
              }
              onMouseEnter={() => setPicked(i)}
              onClick={() => void pick(c)}
            >
              <strong>/{c.name}</strong> <span className="muted">{c.hint}</span>
            </button>
          ))}
          <span className="muted slash-help">↑↓ to choose · Enter to insert · Esc to cancel</span>
        </div>
      )}

      {uploadError && <p className="error">{uploadError}</p>}
    </div>
  );
}

/** Images from a paste or a drop, ignoring everything else on the clipboard. */
function imageFilesFrom(source: DataTransfer | null): File[] {
  if (!source) return [];
  return [...source.files].filter((f) => f.type.startsWith('image/'));
}

/**
 * Store the bytes and get a URL back.
 *
 * The image goes to the server rather than into the document as base64: an inlined
 * screenshot would add a megabyte of text to a note, and the knowledge layer would
 * cheerfully chunk and embed it.
 */
async function uploadImage(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8_192));
  }
  const { url } = await api.post<{ url: string }>('/meetings/images', {
    filename: file.name || 'pasted-image.png',
    mimeType: file.type,
    contentBase64: btoa(binary),
  });
  return url;
}

function Toolbar({ editor, onUpload }: { editor: Editor; onUpload: (files: File[]) => void }) {
  const { ask } = useDialog();
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
          void (async () => {
            const values = await ask({
              title: 'Link to where?',
              body: 'Leave it empty to remove the link.',
              confirmLabel: 'Apply link',
              fields: [
                {
                  name: 'url',
                  label: 'Address',
                  // Not type="url": the field must accept empty to mean "unlink", and a
                  // url input with a value refuses to submit anything unparseable.
                  defaultValue: (editor.getAttributes('link').href as string) ?? 'https://',
                  placeholder: 'https://',
                },
              ],
            });
            if (!values) return;
            if (!values.url.trim()) return chain().unsetLink().run();
            chain().setLink({ href: values.url.trim() }).run();
          })();
        }} />
      <Button label="🖼" title="Insert an image"
        onClick={() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.multiple = true;
          input.onchange = () => onUpload([...(input.files ?? [])]);
          input.click();
        }} />
      <span className="toolbar-sep" />
      <Button label="↶" title="Undo" onClick={() => chain().undo().run()} />
      <Button label="↷" title="Redo" onClick={() => chain().redo().run()} />
    </div>
  );
}
