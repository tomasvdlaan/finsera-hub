import PDFDocument from 'pdfkit';
import type { OrgSettings } from '../../core/settings/settings.service.js';
import { vatLegend, type VatTreatment } from '../../core/money/vat.js';

export interface RenderableQuote {
  number: string | null;
  title: string;
  introduction: string | null;
  notes: string | null;
  version: number;
  issueDate: string | null;
  validUntil: string | null;
  vatTreatment: VatTreatment;
  currency: string;
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
  client: {
    name: string;
    legalName: string | null;
    invoiceAddress: string | null;
    vatNumber: string | null;
  };
  lines: Array<{
    description: string;
    quantity: string;
    unitPriceCents: number;
    amountCents: number;
    unit: string;
  }>;
}

const euro = (cents: number, currency = 'EUR') =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency }).format(cents / 100);

const date = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('nl-NL', { dateStyle: 'long' }).format(new Date(iso)) : '—';

const UNITS: Record<string, string> = { hours: 'uur', days: 'dagen', fixed: '' };

/**
 * The quote PDF.
 *
 * Shares the invoice's layout language deliberately — same header block, same totals
 * alignment — so the two documents read as coming from one company. What differs is
 * what a quote needs and an invoice does not: a scope paragraph, a validity date, and
 * no payment instruction, because nothing is owed yet.
 */
export function renderQuotePdf(quote: RenderableQuote, org: OrgSettings): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── header ──
    doc.fontSize(18).font('Helvetica-Bold').text(org.legalName || 'Finsera');
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#444444')
      .text([org.addressLine1, org.addressLine2].filter(Boolean).join(', '))
      .text(`KvK ${org.kvkNumber || '—'} · BTW ${org.vatNumber || '—'}`)
      .text(org.invoiceEmail || '');

    doc.moveDown(1.5);
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .fillColor('#000000')
      .text(quote.number ? `Offerte ${quote.number}` : 'CONCEPT — nog niet verstuurd');
    doc.fontSize(11).font('Helvetica').text(quote.title);
    if (quote.version > 1) {
      doc.fontSize(9).fillColor('#444444').text(`Versie ${quote.version}`).fillColor('#000000');
    }
    doc.moveDown(0.75);

    // ── dates and client ──
    const y = doc.y;
    doc
      .fontSize(9)
      .font('Helvetica')
      .text(`Datum: ${date(quote.issueDate)}`, 50, y)
      .text(`Geldig tot: ${date(quote.validUntil)}`);

    doc
      .font('Helvetica-Bold')
      .text(quote.client.legalName || quote.client.name, 320, y)
      .font('Helvetica');
    if (quote.client.invoiceAddress) doc.text(quote.client.invoiceAddress, 320);
    if (quote.client.vatNumber) doc.text(`BTW ${quote.client.vatNumber}`, 320);

    doc.moveDown(2);

    // ── the scope, in words, before any numbers ──
    if (quote.introduction) {
      doc.fontSize(10).font('Helvetica').text(quote.introduction, 50, Math.max(doc.y, y + 60), {
        width: 495,
        align: 'left',
      });
      doc.moveDown(1);
    }

    // ── lines ──
    const tableTop = Math.max(doc.y, y + 80);
    const col = { desc: 50, qty: 330, rate: 390, amount: 470 };
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('Omschrijving', col.desc, tableTop);
    doc.text('Aantal', col.qty, tableTop, { width: 50, align: 'right' });
    doc.text('Tarief', col.rate, tableTop, { width: 70, align: 'right' });
    doc.text('Bedrag', col.amount, tableTop, { width: 75, align: 'right' });
    doc
      .moveTo(50, tableTop + 14)
      .lineTo(545, tableTop + 14)
      .strokeColor('#999999')
      .stroke();

    doc.font('Helvetica').fontSize(9);
    let rowY = tableTop + 22;
    for (const line of quote.lines) {
      doc.text(line.description, col.desc, rowY, { width: 270 });
      const unit = UNITS[line.unit] ?? '';
      doc.text(line.unit === 'fixed' ? '—' : `${line.quantity} ${unit}`.trim(), col.qty, rowY, {
        width: 50,
        align: 'right',
      });
      doc.text(
        line.unit === 'fixed' ? '—' : euro(line.unitPriceCents, quote.currency),
        col.rate,
        rowY,
        { width: 70, align: 'right' },
      );
      doc.text(euro(line.amountCents, quote.currency), col.amount, rowY, {
        width: 75,
        align: 'right',
      });
      rowY = Math.max(doc.y, rowY + 14) + 4;
    }

    // ── totals ──
    doc.moveTo(330, rowY).lineTo(545, rowY).strokeColor('#999999').stroke();
    rowY += 8;
    const totalRow = (label: string, cents: number, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
      doc.text(label, 330, rowY, { width: 130, align: 'right' });
      doc.text(euro(cents, quote.currency), col.amount, rowY, { width: 75, align: 'right' });
      rowY += 14;
    };
    totalRow('Subtotaal', quote.subtotalCents);
    totalRow(quote.vatTreatment === 'domestic_21' ? 'BTW 21%' : 'BTW 0%', quote.vatCents);
    totalRow('Totaal', quote.totalCents, true);

    const legend = vatLegend(quote.vatTreatment);
    if (legend) {
      rowY += 6;
      doc.font('Helvetica-Oblique').fontSize(9).text(legend, 50, rowY, { width: 495 });
      rowY = doc.y;
    }

    if (quote.notes) {
      rowY += 10;
      doc.font('Helvetica').fontSize(9).text(quote.notes, 50, rowY, { width: 495 });
      rowY = doc.y;
    }

    // No payment instruction, unlike an invoice — nothing is owed until this is accepted.
    rowY += 16;
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#444444')
      .text(
        `Deze offerte is geldig tot ${date(quote.validUntil)}. Graag horen wij of u akkoord gaat.`,
        50,
        rowY,
        { width: 495 },
      );

    doc.end();
  });
}
