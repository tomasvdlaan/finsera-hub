import { useEffect, useRef, type ReactNode } from 'react';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import { createLowlight, common } from 'lowlight';
import { DOMSerializer, docToMarkdown, markdownToDoc, noteSchema, replacing } from '@platform/note-doc';
import { api } from '../../lib/api.js';

const lowlight = createLowlight(common);
const extensions = replacing('codeBlock', CodeBlockLowlight.configure({ lowlight }));

/**
 * Rich text that is Markdown underneath, for the fields that are not a whole document.
 *
 * The note editor is collaborative: it holds a ProseMirror document, exchanges steps with a
 * server-side authority and needs a socket per note. That is right for a page two people
 * write in during a meeting and far too much for a task description, which one person edits
 * at a time and which lives inside a form.
 *
 * What it shares is the part that matters — the schema and the Markdown, from
 * @platform/note-doc. A description written here parses with the same rules the API uses, so
 * the assistant can read a task the way it reads a note, and an image pasted into either
 * ends up as the same `![](…)`.
 *
 * Saved on blur rather than on every keystroke: this is a field in a form, and a PATCH per
 * character would be a write amplification nobody asked for.
 */
export function MarkdownEditor({
  value,
  onSave,
  placeholder = 'Add a description…',
  editable = true,
  label,
  toolbar = false,
  footer,
}: {
  value: string;
  onSave: (markdown: string) => void;
  placeholder?: string;
  editable?: boolean;
  /**
   * Show the formatting controls.
   *
   * Off by default, and that default is why this is being added rather than assumed: the
   * editor has been rich since it was written — the shared schema, headings, lists, code
   * with highlighting, images on paste — and none of it was reachable except by knowing
   * the Markdown shortcuts. Rich text you cannot see is rich text nobody uses.
   *
   * Opt-in rather than always-on because a one-line field in a form does not want a strip
   * of buttons above it, and half this component's callers are exactly that.
   */
  toolbar?: boolean;
  /** Anything that belongs on the toolbar's right — a send button, a hint. */
  footer?: ReactNode;
  /** Named for screen readers, since there is no <label> that can point at a contenteditable. */
  label?: string;
}) {
  /** The hidden file input the toolbar's image button opens. */
  const file = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    editable,
    extensions: [...extensions, Placeholder.configure({ placeholder })],
    content: markdownToDoc(value ?? '').toJSON() as never,
    onBlur: ({ editor: instance }) => {
      const next = docToMarkdown(instance.state.doc).trim();
      if (next !== (value ?? '').trim()) onSave(next);
    },
    editorProps: {
      // No <label> can point at a contenteditable, so the field names itself.
      attributes: label ? { role: 'textbox', 'aria-label': label } : {},
      /**
       * Paste a screenshot straight into the description.
       *
       * The bytes are uploaded and a URL inserted rather than inlined as base64 — an inlined
       * screenshot would add a megabyte of text to every read of the task and would be
       * chunked and embedded by the knowledge layer as though it were prose.
       */
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])].filter((f) =>
          f.type.startsWith('image/'),
        );
        if (files.length === 0) return false;
        event.preventDefault();
        void uploadAll(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = [...((event as DragEvent).dataTransfer?.files ?? [])].filter((f) =>
          f.type.startsWith('image/'),
        );
        if (files.length === 0) return false;
        event.preventDefault();
        void uploadAll(files);
        return true;
      },
    },
  });

  const uploadAll = async (files: File[]) => {
    for (const file of files) {
      try {
        const url = await uploadImage(file);
        editor?.chain().focus().setImage({ src: url, alt: file.name }).run();
      } catch {
        /* the editor stays usable; the image simply did not land */
      }
    }
  };

  /*
   * Take in a value changed elsewhere, but never while it is being typed into.
   *
   * Without the focus check, a parent re-render mid-sentence would replace the document and
   * put the caret back at the start — which is exactly the bug the collaborative editor was
   * built to stop, in miniature.
   */
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const current = docToMarkdown(editor.state.doc).trim();
    if (current === (value ?? '').trim()) return;
    editor.commands.setContent(markdownToDoc(value ?? '').toJSON() as never, { emitUpdate: false });
  }, [value, editor]);

  if (!editor) return <p className="muted">Loading…</p>;

  /*
   * `isActive` is read on every render rather than subscribed to.
   *
   * TipTap re-renders this component on every selection change already, so the marks under
   * the caret are current — and a subscription would be a second source of the same truth.
   */
  const mark = (name: string, attrs?: Record<string, unknown>) =>
    editor.isActive(name, attrs) ? 'md-tool md-tool-on' : 'md-tool';

  return (
    <div className="markdown-editor" data-framed={toolbar || undefined}>
      {toolbar && (
        /*
         * `onMouseDown` with preventDefault, never `onClick`.
         *
         * A click on a button moves focus out of the contenteditable first, which collapses
         * the selection — so a click on Bold with three words selected would embolden
         * nothing. Preventing the default keeps the selection where it was.
         */
        <div className="md-toolbar" role="toolbar" aria-label="Formatting">
          <button type="button" className={mark('bold')} title="Bold" aria-label="Bold"
            onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}>
            <b>B</b>
          </button>
          <button type="button" className={mark('italic')} title="Italic" aria-label="Italic"
            onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}>
            <i>I</i>
          </button>
          <button type="button" className={mark('highlight')} title="Highlight" aria-label="Highlight"
            onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleHighlight().run(); }}>
            <span className="md-hl">A</span>
          </button>
          <span className="md-sep" aria-hidden="true" />
          <button type="button" className={mark('heading', { level: 2 })} title="Heading" aria-label="Heading"
            onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleHeading({ level: 2 }).run(); }}>
            H
          </button>
          <button type="button" className={mark('bulletList')} title="Bullets" aria-label="Bulleted list"
            onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBulletList().run(); }}>
            <BulletIcon />
          </button>
          <button type="button" className={mark('orderedList')} title="Numbered" aria-label="Numbered list"
            onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleOrderedList().run(); }}>
            1.
          </button>
          <span className="md-sep" aria-hidden="true" />
          <button type="button" className={mark('codeBlock')} title="Code" aria-label="Code block"
            onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleCodeBlock().run(); }}>
            <span className="md-code">&lt;/&gt;</span>
          </button>
          <button type="button" className={mark('blockquote')} title="Quote" aria-label="Quote"
            onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBlockquote().run(); }}>
            &rdquo;
          </button>
          {/* The one control that is not a formatting toggle: images already arrive by paste
              and by drop, and neither is discoverable from a keyboard or a trackpad. */}
          <button type="button" className="md-tool" title="Image" aria-label="Insert an image"
            onMouseDown={(e) => { e.preventDefault(); file.current?.click(); }}>
            <ImageIcon />
          </button>
          {footer && <span className="md-toolbar-end">{footer}</span>}
        </div>
      )}
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const chosen = [...(e.target.files ?? [])];
          e.target.value = '';
          if (chosen.length > 0) void uploadAll(chosen);
        }}
      />
      {/* Deliberately not `.rich-editor .editor-sheet` — those carry the note page's sheet:
          its own border, its own shadow and a hard-coded placeholder. A field in a form wants
          none of that, and inheriting it would put a card inside a card. */}
      <EditorContent editor={editor} />
    </div>
  );
}

function BulletIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M5 3.5h7M5 7h7M5 10.5h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="2.4" cy="3.5" r="1" fill="currentColor" />
      <circle cx="2.4" cy="7" r="1" fill="currentColor" />
      <circle cx="2.4" cy="10.5" r="1" fill="currentColor" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.6" y="2.6" width="10.8" height="8.8" rx="1.4" stroke="currentColor" strokeWidth="1.2" />
      <path d="m2.6 9.4 2.6-2.6 2.6 2.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9.2" cy="5.6" r="1" fill="currentColor" />
    </svg>
  );
}

async function uploadImage(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
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
 * The first image in a description, for the card to show as a thumbnail.
 *
 * Parsed from the Markdown rather than stored alongside it, so it cannot go stale: change the
 * picture in the description and the card follows without anything having to remember.
 */
export function firstImage(markdown: string | null | undefined): string | null {
  if (!markdown) return null;
  const doc = markdownToDoc(markdown);
  let found: string | null = null;
  doc.descendants((node) => {
    if (found) return false;
    if (node.type.name === 'image' && typeof node.attrs.src === 'string') found = node.attrs.src;
    return true;
  });
  return found;
}

/**
 * The same Markdown, read-only.
 *
 * A second editor instance per comment would be several hundred kilobytes of ProseMirror
 * doing nothing but rendering — so this parses with the shared schema and serialises straight
 * to DOM nodes. Same parser, same rules: a checklist written in a comment looks like the one
 * written in a note, and neither can express anything the other cannot.
 *
 * Nothing here trusts the input: the Markdown parser is configured `html: false` and the only
 * inline HTML it accepts is a colour span, so a comment cannot smuggle markup into the page.
 */
export function Markdown({ value, className }: { value: string; className?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    node.replaceChildren(
      DOMSerializer.fromSchema(noteSchema).serializeFragment(markdownToDoc(value ?? '').content),
    );
  }, [value]);

  return <div ref={host} className={className ? `markdown-body ${className}` : 'markdown-body'} />;
}
