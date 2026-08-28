import { useCallback, useEffect, useRef, useState } from 'react';
/*
 * Imported for its types, not its value.
 *
 * The extension itself arrives with the shared schema; this makes TipTap's `Commands`
 * augmentation part of the program so `setColor` type-checks. Without it the command exists
 * at runtime and does not exist to the compiler, which is a confusing way to be told that a
 * package is only a transitive dependency.
 */
import '@tiptap/extension-color';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { CharacterCount, Placeholder, Selection } from '@tiptap/extensions';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { createLowlight, common } from 'lowlight';
import { replacing } from '@platform/note-doc';
import { api } from '../../lib/api.js';
import { useDialog } from '../../shell/ui/Dialog.js';
import type { NodeJson, NoteCommand } from './noteCommands.js';
import { CollabExtension } from './collabExtension.js';
import { Pagination } from './pagination.js';
import { useNoteDoc } from './useNoteDoc.js';

/** Syntax highlighting for fenced code. `common` is ~35 languages rather than all 190. */
const lowlight = createLowlight(common);

/**
 * The extensions the editor runs with.
 *
 * The schema-defining half comes from @platform/note-doc and is shared, byte for byte, with
 * the API — that is what makes a step this editor produces applicable on the server. The rest
 * is chrome: none of it adds a node or a mark, so none of it can change the document's shape.
 *
 * CodeBlock is swapped for the lowlight version, which extends it and registers the same node
 * with the same attributes. See `replacing` for why that is the only substitution allowed.
 */
const documentExtensions = replacing('codeBlock', CodeBlockLowlight.configure({ lowlight }));

/**
 * The note editor.
 *
 * WYSIWYG on the surface, Markdown at rest. That combination is deliberate: the model writes
 * into the same document during a meeting, and a model produces correct Markdown far more
 * reliably than it produces editor JSON. It also keeps the document greppable, diffable and
 * indexable by the knowledge layer, and means nothing already written needs converting.
 *
 * What changed is the middle. The editor used to hold the body as a Markdown string and
 * autosave the whole thing; now it holds a ProseMirror document and exchanges changes with
 * the server, which is the only arrangement in which two people — or a person and the
 * assistant — can write in the same note without one of them silently losing their work. The
 * Markdown is derived on the server from the same shared code that runs here.
 *
 * The editor is not built until the first snapshot arrives, because the collaboration plugin
 * has to be told which version it is starting from. Hence the wrapper: `EditorSurface` below
 * is only ever mounted with a document in hand.
 */
export function RichEditor({
  noteId,
  editable = true,
  commands = [],
}: {
  /** The note being edited. The document is fetched and kept in sync for this id. */
  noteId: string;
  editable?: boolean;
  /** Toolbar actions that insert something and do something. See noteCommands.ts. */
  commands?: NoteCommand[];
}) {
  const { ready, clientId, connected, error, attach } = useNoteDoc(noteId);

  if (!ready) {
    return (
      <div className="rich-editor">
        <p className="muted">{error ?? 'Opening the note…'}</p>
      </div>
    );
  }

  return (
    <EditorSurface
      // Remounted for a different note or a fresh snapshot: the collab plugin's starting
      // version is fixed at creation, so reusing the editor would leave it counting from
      // somebody else's document.
      key={`${noteId}:${ready.version}`}
      start={ready}
      clientId={clientId}
      attach={attach}
      connected={connected}
      error={error}
      editable={editable}
      commands={commands}
    />
  );
}

function EditorSurface({
  start,
  clientId,
  attach,
  connected,
  error,
  editable,
  commands,
}: {
  start: { version: number; doc: unknown };
  clientId: string;
  attach: (editor: Editor) => () => void;
  connected: boolean;
  error: string | null;
  editable: boolean;
  commands: NoteCommand[];
}) {
  /** Paste and drop handlers are created before the editor exists, so they read it here. */
  const editorRef = useRef<Editor | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { ask } = useDialog();

  const editor = useEditor({
    editable,
    extensions: [
      // The shared half. Everything that defines a node or a mark comes from here, so this
      // editor and the API agree on what a note is. See @platform/note-doc.
      ...documentExtensions,

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

      // Draws the page boundaries. Adds no node and no mark — every break is a decoration, so
      // none of this reaches the document, the steps, or the Markdown. See pagination.ts.
      Pagination,

      // What turns local typing into steps the server can accept.
      CollabExtension.configure({ version: start.version, clientId }),
    ],
    // The document as the server has it, not a Markdown string. Parsing is the server's job
    // now, which is what stops the two sides disagreeing about what the text meant.
    content: start.doc as never,
    editorProps: {
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
   * Invoked from the toolbar. Nothing is typed into the body to trigger it any more, so there
   * is no typed text to clean up first and cancelling leaves the note exactly as it was.
   */
  const runCommand = useCallback(async (command: NoteCommand) => {
    const instance = editorRef.current;
    if (!instance) return;

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

  /*
   * There is no effect here that writes external content in.
   *
   * There used to be: it compared the incoming Markdown with the editor's, and on any
   * difference called `setContent` and then tried to put the cursor back where it had been.
   * That was the best available answer while the body was a string, and it was still wrong —
   * it discarded anything typed in the moment between the server's copy being read and the
   * replacement landing, and the cursor restoration was a guess that failed whenever the
   * document had shortened above it.
   *
   * Changes from elsewhere — another person, the assistant, the note-taking behaviour — now
   * arrive as steps and are applied by `receiveTransaction` in useNoteDoc, which maps the
   * selection through them properly. Nothing needs to be reconciled here.
   */

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  /*
   * Hand the editor to the connection, and take it back when this component goes.
   *
   * In an effect rather than in `onCreate`, so that it re-registers whenever either side is
   * replaced. Registering once at creation left the hook holding a stale or empty reference
   * after any remount, and the symptom was silent: everything connected, nothing arrived.
   */
  useEffect(() => {
    if (!editor) return;
    return attach(editor);
  }, [editor, attach]);

  /*
   * Typing is allowed while disconnected, and that is deliberate.
   *
   * Unsent steps sit in the collaboration plugin and go out the moment the socket returns, so
   * nothing written during a blip is lost. Locking the editor would protect nothing and would
   * interrupt the one situation where somebody is most likely mid-sentence — a laptop waking
   * up in a meeting room. What is not acceptable is looking fine while offline, so it says so.
   */
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  if (!editor) return <p className="muted">Loading the editor…</p>;

  return (
    <div className="rich-editor">
      {!connected && (
        <p className="muted" role="status">
          {error ?? 'Reconnecting… what you write now will be saved when it comes back.'}
        </p>
      )}
      {editable && (
        <Toolbar
          editor={editor}
          active={active}
          commands={commands}
          onUpload={uploadAll}
          onLink={() => void linkSelection()}
          onCommand={(c) => void runCommand(c)}
        />
      )}

      {/*
        The page.

        A bounded, centred column with margins, because this reads as a document and a
        document has a width. It replaces a canvas that ran the full width of whichever pane
        it was in — fine for a wiki, wrong for something people write prose in and print.
      */}
      <div className="editor-page">
        {/*
          EditorContent renders a wrapper div of its own around the ProseMirror element, so
          the sheet is styled here rather than on `.tiptap` — otherwise the thing being sized
          is not the thing that is a child of the page, and the page's height never reaches it.
        */}
        <EditorContent editor={editor} className="editor-sheet" />
      </div>

      {/*
        The status bar, where a word processor puts one.

        Below the writing rather than in the toolbar: it reports on the document instead of
        acting on it, and the two do not belong in the same strip. The page count is whatever
        the pagination decorations last worked out, so on a surface that is not paginated it
        stays at one and only the word count is worth reading.
      */}
      <Stats editor={editor} />

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
 * How long the document is, in the two units that mean something.
 *
 * Both are read through useEditorState for the same reason the toolbar's buttons are: v3 does
 * not re-render on every transaction, so a component that reads `editor.storage` in its body
 * shows whatever was true when it mounted.
 */
function Stats({ editor }: { editor: Editor }) {
  const stats = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      paginated: e.storage.notePagination.paginated,
      pages: e.storage.notePagination.pages,
      words: e.storage.characterCount.words(),
    }),
  });

  return (
    <div className="editor-status">
      {/* Only where there are pages. On the note page and in the dock the writing runs on. */}
      {stats.paginated && (
        <>
          <span>
            {stats.pages} {stats.pages === 1 ? 'page' : 'pages'}
          </span>
          <span className="editor-status-dot" aria-hidden="true" />
        </>
      )}
      <span>
        {stats.words} {stats.words === 1 ? 'word' : 'words'}
      </span>
    </div>
  );
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
        textColour: (e.getAttributes('textStyle').color as string | undefined) ?? '',
        highlightColour: (e.getAttributes('highlight').color as string | undefined) ?? '',
        h1: e.isActive('heading', { level: 1 }),
        h2: e.isActive('heading', { level: 2 }),
        h3: e.isActive('heading', { level: 3 }),
      } : null),
    }) ?? {
      bold: false, italic: false, strike: false, highlight: false, code: false, link: false,
      blockquote: false, bulletList: false, orderedList: false, taskList: false,
      codeBlock: false, textColour: '', highlightColour: '', h1: false, h2: false, h3: false,
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

/**
 * The toolbar, and now the only place formatting lives.
 *
 * There was a bubble menu as well, floating over the selection. It went with the drag handle
 * when the editor stopped pretending to be a Notion page: both are affordances that appear
 * and move as you work, and in a document you want the controls to stay where you left them.
 * Everything the bubble menu offered is here, in the same order.
 *
 * The last group is the commands that used to be typed as `/ticket`. They are here for the
 * same reason a word processor puts them under Insert — you can see what is available without
 * having to know it exists.
 */
/**
 * A colour swatch that opens the operating system's picker.
 *
 * The swatch shows what is currently applied, so the button says what the selection is rather
 * than only what it would become. Right-click — or the small × — removes the colour, because
 * a picker has no way to express "none" and text you cannot get back to the default is worse
 * than text you could never colour.
 */
function ColourButton({
  label,
  title,
  value,
  onPick,
  onClear,
}: {
  label: string;
  title: string;
  value: string;
  onPick: (colour: string) => void;
  onClear: () => void;
}) {
  return (
    <span className="toolbar-colour" title={title}>
      <label>
        <span aria-hidden="true">{label}</span>
        <span className="toolbar-colour-bar" style={{ background: value || 'transparent' }} />
        <input
          type="color"
          aria-label={title}
          value={value || '#888888'}
          onChange={(e) => onPick(e.target.value)}
        />
      </label>
      {value && (
        <button
          type="button"
          className="toolbar-colour-clear"
          title={`Remove ${title.toLowerCase()}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClear}
        >
          ×
        </button>
      )}
    </span>
  );
}

function Toolbar({
  editor,
  active,
  commands,
  onUpload,
  onLink,
  onCommand,
}: {
  editor: Editor;
  /** Subscribed once by the parent; see useActiveMarks for why not read here. */
  active: ReturnType<typeof useActiveMarks>;
  commands: NoteCommand[];
  onUpload: (files: File[]) => void;
  onLink: () => void;
  onCommand: (command: NoteCommand) => void;
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
      {/*
        Colour, through a native picker.
        
        It always yields `#rrggbb`, which is exactly and only what the note format accepts —
        so the control cannot produce a colour the document would refuse to store. A bespoke
        swatch popover would look more like Word and would have to be kept in step with the
        parser by hand.
      */}
      <ColourButton
        label="A"
        title="Text colour"
        value={active.textColour}
        onPick={(c) => chain().setColor(c).run()}
        onClear={() => chain().unsetColor().run()}
      />
      <ColourButton
        label="▮"
        title="Highlight colour"
        value={active.highlightColour}
        onPick={(c) => chain().setHighlight({ color: c }).run()}
        onClear={() => chain().unsetHighlight().run()}
      />
      <Button
        label="⌫"
        title="Clear formatting"
        onClick={() => chain().unsetAllMarks().run()}
      />
      <span className="toolbar-sep" />
      <Button label="―" title="Horizontal rule"
        onClick={() => chain().setHorizontalRule().run()} />
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

      {commands.length > 0 && (
        <>
          <span className="toolbar-sep" />
          {commands.map((c) => (
            <button
              key={c.name}
              type="button"
              className="toolbar-command"
              title={c.hint}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onCommand(c)}
            >
              {c.label}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
