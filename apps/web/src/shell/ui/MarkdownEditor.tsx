import { useEffect, useRef } from 'react';
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
}: {
  value: string;
  onSave: (markdown: string) => void;
  placeholder?: string;
  editable?: boolean;
  /** Named for screen readers, since there is no <label> that can point at a contenteditable. */
  label?: string;
}) {
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
  return (
    <div className="markdown-editor">
      {/* Deliberately not `.rich-editor .editor-sheet` — those carry the note page's sheet:
          its own border, its own shadow and a hard-coded placeholder. A field in a form wants
          none of that, and inheriting it would put a card inside a card. */}
      <EditorContent editor={editor} />
    </div>
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
