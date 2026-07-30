import { useCallback, useEffect, useRef, useState } from 'react';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { DragHandle } from '@tiptap/extension-drag-handle-react';
import Image from '@tiptap/extension-image';
// v3 ships all four table nodes from one package, with named exports only.
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { CharacterCount, Placeholder, Selection } from '@tiptap/extensions';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
// v3 moved the menus to their own entry point.
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { createLowlight, common } from 'lowlight';
import { Markdown } from 'tiptap-markdown';
import { api } from '../../lib/api.js';
import { useDialog } from '../../shell/ui/Dialog.js';
import { MarkdownBlockquote, MarkdownHighlight } from './markdownMark.js';
import { SLASH, matching, type NodeJson, type SlashCommand } from './slashCommands.js';

/** Syntax highlighting for fenced code. `common` is ~35 languages rather than all 190. */
const lowlight = createLowlight(common);

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
  const { ask } = useDialog();

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
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        /*
         * Two of StarterKit's own extensions are switched off, both for the same reason.
         *
         * `underline` has no Markdown representation — tiptap-markdown ships specs for bold,
         * italic, strike, code and link, and nothing else — so with `html: false` the mark is
         * deleted on the next autosave. It was on by default and bound to Cmd+U, which meant
         * the keyboard shortcut every writer has in their fingers produced text that looked
         * underlined and lost it on save. There is no `__underline__` in Markdown to map it
         * to; the honest move is not to offer it.
         *
         * `codeBlock` is replaced below by the lowlight version, which serialises identically
         * (```lang) and syntax-highlights what is inside.
         */
        underline: false,
        codeBlock: false,
        // Replaced below by a version that does not corrupt over an empty line.
        blockquote: false,
        // StarterKit v3 includes Link. Registering the separate package as well made it a
        // duplicate extension, which TipTap resolves by warning and using one of them.
        link: { openOnClick: false },
      }),
      // Both of these exist to keep the Markdown honest. See markdownMark.ts.
      MarkdownHighlight,
      MarkdownBlockquote,
      // Markdown carries images as ![alt](url), so they survive the round trip.
      Image.configure({ inline: false, allowBase64: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      CodeBlockLowlight.configure({ lowlight }),

      /*
       * Chrome, none of which touches what is stored.
       *
       * Placeholder replaces a CSS `::before` that could only ever address the first empty
       * paragraph; this one prompts on whichever block is empty, which is where the hint is
       * actually useful. Selection keeps the highlight visible when focus moves to the bubble
       * menu — without it, clicking Bold appears to deselect the words being emboldened.
       */
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === 'heading' ? 'Heading' : "Write, or press '/' for a block",
      }),
      Selection,
      CharacterCount,

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

  const active = useActiveMarks(editor);

  /**
   * Ask where a link should point, and apply or remove it.
   *
   * One implementation, called from the toolbar and from the bubble menu. Two copies of "what
   * counts as removing a link" is exactly the kind of small divergence nobody notices until one
   * of them stops unlinking.
   */
  const linkSelection = useCallback(async () => {
    const instance = editorRef.current;
    if (!instance) return;
    const values = await ask({
      title: 'Link to where?',
      body: 'Leave it empty to remove the link.',
      confirmLabel: 'Apply link',
      fields: [
        {
          name: 'url',
          label: 'Address',
          // Not type="url": the field must accept empty to mean "unlink", and a url input
          // with a value refuses to submit anything unparseable.
          defaultValue: (instance.getAttributes('link').href as string) ?? 'https://',
          placeholder: 'https://',
        },
      ],
    });
    if (!values) return;
    const chain = instance.chain().focus();
    if (!values.url.trim()) chain.unsetLink().run();
    else chain.setLink({ href: values.url.trim() }).run();
  }, [ask]);

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
      {editable && (
        <Toolbar
          editor={editor}
          active={active}
          onUpload={uploadAll}
          onLink={() => void linkSelection()}
        />
      )}

      {/*
        Formatting where the text is, rather than at the top of the page.
        
        The toolbar stays — it is discoverable, and it holds the things you reach for before
        writing anything, like inserting a table. This holds the things you only ever want with
        words already selected, which is most of them.
      */}
      {editable && (
        <BubbleMenu editor={editor} className="bubble-menu">
          <Button label="B" title="Bold" active={active.bold}
            onClick={() => editor.chain().focus().toggleBold().run()} />
          <Button label="I" title="Italic" active={active.italic}
            onClick={() => editor.chain().focus().toggleItalic().run()} />
          <Button label="S" title="Strikethrough" active={active.strike}
            onClick={() => editor.chain().focus().toggleStrike().run()} />
          <Button label="◼" title="Highlight" active={active.highlight}
            onClick={() => editor.chain().focus().toggleHighlight().run()} />
          <Button label="‹›" title="Code" active={active.code}
            onClick={() => editor.chain().focus().toggleCode().run()} />
          <span className="toolbar-sep" />
          <Button label="H2" title="Heading" active={active.h2}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
          <Button label="❝" title="Quote" active={active.blockquote}
            onClick={() => editor.chain().focus().toggleBlockquote().run()} />
          <Button label="🔗" title="Link" active={active.link}
            onClick={() => void linkSelection()} />
        </BubbleMenu>
      )}

      {/*
        A handle for moving a block.
        
        Notion's most-copied affordance and the one that most changes how a long note feels:
        reordering by dragging rather than by cutting and pasting, which in a Markdown document
        means never having to get the blank lines right by hand.
      */}
      {editable && (
        <DragHandle editor={editor}>
          <span className="drag-grip" aria-hidden="true">
            ⠿
          </span>
        </DragHandle>
      )}

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

/**
 * What is active where the cursor is.
 *
 * Read through useEditorState rather than calling editor.isActive() during render, because v3
 * defaults `shouldRerenderOnTransaction` to false — so a component that reads isActive() in its
 * body renders once and then shows whatever was true at mount. That is why the toolbar's
 * buttons stopped lighting up: not a styling problem, a stale-read problem, and it has been
 * that way since the v3 upgrade.
 *
 * The legacy flag would fix it by re-rendering the whole editor on every keystroke, which in a
 * room where somebody types continuously for fifteen minutes is the wrong trade. This
 * subscribes to exactly the booleans the buttons need and re-renders when one of them changes.
 */
function useActiveMarks(editor: Editor | null) {
  return (
    useEditorState({
      editor,
      selector: ({ editor: e }) => (e ? {
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        strike: e.isActive('strike'),
        highlight: e.isActive('highlight'),
        code: e.isActive('code'),
        link: e.isActive('link'),
        blockquote: e.isActive('blockquote'),
        bulletList: e.isActive('bulletList'),
        orderedList: e.isActive('orderedList'),
        taskList: e.isActive('taskList'),
        codeBlock: e.isActive('codeBlock'),
        h1: e.isActive('heading', { level: 1 }),
        h2: e.isActive('heading', { level: 2 }),
        h3: e.isActive('heading', { level: 3 }),
      } : null),
    }) ?? {
      bold: false, italic: false, strike: false, highlight: false, code: false, link: false,
      blockquote: false, bulletList: false, orderedList: false, taskList: false,
      codeBlock: false, h1: false, h2: false, h3: false,
    }
  );
}

/**
 * One button, shared by the toolbar and the bubble menu.
 *
 * At module scope rather than defined inside the toolbar: a component created during render is
 * a new type on every render, so React remounts every button on every keystroke — which in an
 * editor is every button, several times a second.
 */
function Button({
  label,
  title,
  active,
  onClick,
}: {
  label: string;
  title: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={active ? 'toolbar-on' : undefined}
      // The bubble menu sits over the document; a mousedown that moves focus would collapse
      // the selection before the command runs.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function Toolbar({
  editor,
  active,
  onUpload,
  onLink,
}: {
  editor: Editor;
  /** Subscribed once by the parent; see useActiveMarks for why not read here. */
  active: ReturnType<typeof useActiveMarks>;
  onUpload: (files: File[]) => void;
  onLink: () => void;
}) {
  const chain = useCallback(() => editor.chain().focus(), [editor]);

  return (
    <div className="editor-toolbar">
      <Button label="H1" title="Heading 1" active={active.h1}
        onClick={() => chain().toggleHeading({ level: 1 }).run()} />
      <Button label="H2" title="Heading 2" active={active.h2}
        onClick={() => chain().toggleHeading({ level: 2 }).run()} />
      <Button label="H3" title="Heading 3" active={active.h3}
        onClick={() => chain().toggleHeading({ level: 3 }).run()} />
      <span className="toolbar-sep" />
      <Button label="B" title="Bold" active={active.bold}
        onClick={() => chain().toggleBold().run()} />
      <Button label="I" title="Italic" active={active.italic}
        onClick={() => chain().toggleItalic().run()} />
      <Button label="S" title="Strikethrough" active={active.strike}
        onClick={() => chain().toggleStrike().run()} />
      <Button label="◼" title="Highlight" active={active.highlight}
        onClick={() => chain().toggleHighlight().run()} />
      <Button label="‹›" title="Code" active={active.code}
        onClick={() => chain().toggleCode().run()} />
      <span className="toolbar-sep" />
      <Button label="•" title="Bullet list" active={active.bulletList}
        onClick={() => chain().toggleBulletList().run()} />
      <Button label="1." title="Numbered list" active={active.orderedList}
        onClick={() => chain().toggleOrderedList().run()} />
      <Button label="☑" title="Task list" active={active.taskList}
        onClick={() => chain().toggleTaskList().run()} />
      <Button label="❝" title="Quote" active={active.blockquote}
        onClick={() => chain().toggleBlockquote().run()} />
      <span className="toolbar-sep" />
      <Button label="▦" title="Insert table"
        onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
      <Button label="🔗" title="Link" active={active.link} onClick={onLink} />
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
