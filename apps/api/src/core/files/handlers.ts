import { extensionOf, normaliseText, type FileTypeHandler } from './file-type.js';

/**
 * The built-in handlers.
 *
 * Each is self-contained: recognise, extract, preview. Adding a format means adding one
 * of these to the list — nothing else in the platform changes.
 */

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLS = 'application/vnd.ms-excel';

/**
 * Strip everything except a small, known-safe set of tags.
 *
 * Converted documents are untrusted input: a .docx can carry arbitrary markup, and this
 * output is rendered as HTML. Allowlisting beats blocklisting — anything unrecognised is
 * dropped rather than guessed at.
 */
function sanitiseHtml(html: string): string {
  const allowed = new Set([
    'p', 'br', 'strong', 'em', 'b', 'i', 'u', 'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'pre', 'code',
  ]);

  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (match, tag: string) => {
      const name = tag.toLowerCase();
      if (!allowed.has(name)) return '';
      // Attributes are dropped wholesale: no href, no src, no style, no event handlers.
      return match.startsWith('</') ? `</${name}>` : `<${name}>`;
    });
}

const textHandler: FileTypeHandler = {
  id: 'text',
  label: 'Text',
  matches: (mime, filename) =>
    ['text/plain', 'text/csv', 'application/json'].some((t) => mime.startsWith(t)) ||
    ['.txt', '.csv', '.json', '.log'].includes(extensionOf(filename)),
  extract: async (data) => normaliseText(data.toString('utf8')),
  preview: async (data) => ({ kind: 'text', text: data.toString('utf8').slice(0, 200_000) }),
};

const markdownHandler: FileTypeHandler = {
  id: 'markdown',
  label: 'Markdown',
  matches: (mime, filename) =>
    mime.startsWith('text/markdown') || ['.md', '.markdown'].includes(extensionOf(filename)),
  extract: async (data) => normaliseText(data.toString('utf8')),
  preview: async (data) => ({ kind: 'markdown', text: data.toString('utf8').slice(0, 200_000) }),
};

const htmlHandler: FileTypeHandler = {
  id: 'html',
  label: 'HTML',
  matches: (mime, filename) =>
    mime.startsWith('text/html') || ['.html', '.htm'].includes(extensionOf(filename)),
  extract: async (data) =>
    normaliseText(
      data
        .toString('utf8')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
        .replace(/<[^>]+>/g, ' '),
    ),
  preview: async (data) => ({ kind: 'html', html: sanitiseHtml(data.toString('utf8')) }),
};

const docxHandler: FileTypeHandler = {
  id: 'docx',
  label: 'Word document',
  matches: (mime, filename) => mime === DOCX || extensionOf(filename) === '.docx',
  extract: async (data) => {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ buffer: data });
    return normaliseText(value);
  },
  // Rendered client-side by docx-preview, which reproduces the real page layout —
  // styles, tables, spacing. A server-side conversion gives semantic HTML with the
  // formatting stripped, which is not what "show me the contract" means.
  preview: async () => ({ kind: 'binary', mimeType: DOCX, hint: 'docx' }),
};

const MAX_PREVIEW_ROWS = 200;

const xlsxHandler: FileTypeHandler = {
  id: 'xlsx',
  label: 'Spreadsheet',
  matches: (mime, filename) =>
    mime === XLSX || mime === XLS || ['.xlsx', '.xls'].includes(extensionOf(filename)),
  extract: async (data) => {
    const xlsx = await import('xlsx');
    const book = xlsx.read(data, { type: 'buffer' });
    // Sheet names carry meaning a bare grid of numbers does not.
    const text = book.SheetNames.map((name) => {
      const sheet = book.Sheets[name];
      if (!sheet) return '';
      const csv = xlsx.utils.sheet_to_csv(sheet, { blankrows: false });
      return csv.trim() ? `## Sheet: ${name}\n${csv}` : '';
    })
      .filter(Boolean)
      .join('\n\n');
    return normaliseText(text);
  },
  preview: async (data) => {
    const xlsx = await import('xlsx');
    const book = xlsx.read(data, { type: 'buffer' });
    const sheets = book.SheetNames.map((name) => {
      const sheet = book.Sheets[name];
      const rows = sheet
        ? (xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false }) as unknown[][])
        : [];
      return {
        name,
        // Capped so a 50,000-row export cannot freeze the browser.
        rows: rows.slice(0, MAX_PREVIEW_ROWS).map((r) => r.map((c) => (c == null ? '' : String(c)))),
        truncated: rows.length > MAX_PREVIEW_ROWS,
      };
    });
    return { kind: 'sheets', sheets };
  },
};

const pdfHandler: FileTypeHandler = {
  id: 'pdf',
  label: 'PDF',
  matches: (mime, filename) => mime === 'application/pdf' || extensionOf(filename) === '.pdf',
  extract: async (data) => {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const { text } = await extractText(pdf, { mergePages: true });
    return normaliseText(Array.isArray(text) ? text.join('\n\n') : text);
  },
  // Browsers render PDFs natively and better than anything we would build.
  preview: async () => ({ kind: 'binary', mimeType: 'application/pdf', hint: 'pdf' }),
};

const imageHandler: FileTypeHandler = {
  id: 'image',
  label: 'Image',
  matches: (mime, filename) =>
    mime.startsWith('image/') ||
    ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(extensionOf(filename)),
  // No text to extract without OCR, which is deliberately out of scope (brief §1).
  preview: async (_data, mimeType) => ({
    kind: 'binary',
    // SVG is rendered as a download rather than inline: it is executable markup.
    mimeType: mimeType.startsWith('image/') ? mimeType : 'image/png',
    hint: 'image',
  }),
};

/** Order matters: the first match wins, so specific handlers precede general ones. */
export const builtInHandlers: FileTypeHandler[] = [
  markdownHandler, // before text — .md is also text/*
  htmlHandler,
  docxHandler,
  xlsxHandler,
  pdfHandler,
  imageHandler,
  textHandler,
];

export { sanitiseHtml };
