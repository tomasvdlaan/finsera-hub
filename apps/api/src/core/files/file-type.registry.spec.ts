import { beforeEach, describe, expect, it } from 'vitest';
import * as xlsx from 'xlsx';
import { FileTypeRegistry } from './file-type.registry.js';
import { sanitiseHtml } from './handlers.js';
import type { FileTypeHandler } from './file-type.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('FileTypeRegistry', () => {
  let registry: FileTypeRegistry;

  beforeEach(() => {
    registry = new FileTypeRegistry();
  });

  it('resolves the formats Finsera actually uses', () => {
    expect(registry.resolve('text/markdown', 'a.md')?.id).toBe('markdown');
    expect(registry.resolve(DOCX, 'a.docx')?.id).toBe('docx');
    expect(registry.resolve(XLSX_MIME, 'a.xlsx')?.id).toBe('xlsx');
    expect(registry.resolve('application/pdf', 'a.pdf')?.id).toBe('pdf');
    expect(registry.resolve('image/png', 'a.png')?.id).toBe('image');
  });

  it('falls back to the filename when the browser sends a useless mime type', () => {
    // Browsers routinely send application/octet-stream or nothing at all.
    expect(registry.resolve('application/octet-stream', 'contract.docx')?.id).toBe('docx');
    expect(registry.resolve('', 'figures.xlsx')?.id).toBe('xlsx');
  });

  it('prefers markdown over plain text, which also matches', () => {
    // Order matters in the handler list; .md is text/* too.
    expect(registry.resolve('text/markdown', 'notes.md')?.id).toBe('markdown');
  });

  it('reports what can be indexed and what can only be previewed', () => {
    const byId = Object.fromEntries(registry.describe().map((h) => [h.id, h]));
    expect(byId.docx).toMatchObject({ canIndex: true, canPreview: true });
    // Images have no text without OCR, which is deliberately out of scope.
    expect(byId.image).toMatchObject({ canIndex: false, canPreview: true });
  });

  it('returns no handler for a format it does not know', () => {
    expect(registry.resolve('application/zip', 'archive.zip')).toBeNull();
    expect(registry.canExtract('application/zip', 'archive.zip')).toBe(false);
  });

  // ── extraction ──

  it('extracts text from a spreadsheet, labelling each sheet', async () => {
    const book = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(
      book,
      xlsx.utils.aoa_to_sheet([
        ['Quarter', 'Margin'],
        ['Q3', 0.32],
      ]),
      'Margins',
    );
    const buffer = Buffer.from(xlsx.write(book, { type: 'buffer', bookType: 'xlsx' }));

    const text = await registry.extract(buffer, XLSX_MIME, 'margins.xlsx');
    expect(text).toContain('Margins'); // the sheet name carries meaning
    expect(text).toContain('0.32');
  });

  it('returns null rather than throwing on a corrupt file', async () => {
    // A truncated or password-protected upload must not fail the upload — the document
    // is still stored and downloadable, just not searchable inside.
    expect(await registry.extract(Buffer.from('not a zip'), DOCX, 'broken.docx')).toBeNull();
  });

  it('returns null for a format with no extractor', async () => {
    expect(await registry.extract(Buffer.from([0x89, 0x50]), 'image/png', 'a.png')).toBeNull();
  });

  // ── previews ──

  it('previews a spreadsheet as rows, capped', async () => {
    const rows = Array.from({ length: 260 }, (_, i) => [`row ${i}`, i]);
    const book = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet(rows), 'Big');
    const buffer = Buffer.from(xlsx.write(book, { type: 'buffer', bookType: 'xlsx' }));

    const preview = await registry.preview(buffer, XLSX_MIME, 'big.xlsx');
    expect(preview.kind).toBe('sheets');
    if (preview.kind !== 'sheets') return;
    // A 50,000-row export must not freeze the browser.
    expect(preview.sheets[0]!.rows.length).toBe(200);
    expect(preview.sheets[0]!.truncated).toBe(true);
  });

  it('tells the caller to fetch the bytes for a PDF', async () => {
    const preview = await registry.preview(Buffer.from('%PDF-1.4'), 'application/pdf', 'a.pdf');
    expect(preview).toMatchObject({ kind: 'binary', hint: 'pdf' });
  });

  it('renders Word client-side rather than converting it server-side', async () => {
    // A server-side conversion gives semantic HTML with the formatting stripped, which
    // is not what "show me the contract" means.
    const preview = await registry.preview(Buffer.from('PK'), DOCX, 'a.docx');
    expect(preview).toMatchObject({ kind: 'binary', hint: 'docx' });
  });

  it('explains itself when a format has no preview', async () => {
    const preview = await registry.preview(Buffer.from('x'), 'application/zip', 'a.zip');
    expect(preview.kind).toBe('none');
    if (preview.kind === 'none') expect(preview.reason).toMatch(/download/i);
  });

  // ── extensibility ──

  it('accepts a new handler that takes precedence over a built-in one', async () => {
    const custom: FileTypeHandler = {
      id: 'csv-table',
      label: 'CSV table',
      matches: (_m, filename) => filename.endsWith('.csv'),
      preview: async () => ({ kind: 'text', text: 'custom' }),
    };
    registry.register(custom);

    // Registered ahead of the general text handler, which also matches .csv.
    expect(registry.resolve('text/csv', 'data.csv')?.id).toBe('csv-table');
    const preview = await registry.preview(Buffer.from('a,b'), 'text/csv', 'data.csv');
    expect(preview).toMatchObject({ kind: 'text', text: 'custom' });
  });

  it('refuses a duplicate handler id', () => {
    const handler: FileTypeHandler = { id: 'docx', label: 'dup', matches: () => false };
    expect(() => registry.register(handler)).toThrow(/already registered/);
  });
});

/**
 * Previews render converted document markup, so this is a security boundary rather than
 * a formatting nicety: a .docx is untrusted input that arrives from a client.
 */
describe('sanitiseHtml', () => {
  it('keeps the formatting that makes a contract readable', () => {
    const html = sanitiseHtml('<h1>Title</h1><p><strong>Bold</strong> and <em>italic</em></p>');
    expect(html).toContain('<h1>');
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
  });

  it('removes scripts entirely, not just their tags', () => {
    expect(sanitiseHtml('<p>ok</p><script>steal()</script>')).not.toContain('steal()');
  });

  it('strips event handlers and every other attribute', () => {
    const html = sanitiseHtml('<p onclick="steal()" style="x" class="y">text</p>');
    expect(html).toBe('<p>text</p>');
  });

  it('drops tags that could load or navigate anywhere', () => {
    const html = sanitiseHtml('<a href="http://evil">x</a><img src="http://evil"><iframe></iframe>');
    expect(html).not.toContain('href');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<iframe');
    expect(html).toContain('x'); // the text survives, the link does not
  });

  it('removes comments, where payloads like to hide', () => {
    expect(sanitiseHtml('<p>a</p><!-- <script>x()</script> -->')).not.toContain('script');
  });
});
