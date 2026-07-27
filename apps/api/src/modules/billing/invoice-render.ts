import PDFDocument from 'pdfkit';
import type { OrgSettings } from '../../core/settings/settings.service.js';
import { vatLegend, type VatTreatment } from '../../core/money/vat.js';

/** Everything a rendered invoice needs, gathered by the service before rendering. */
export interface RenderableInvoice {
  kind: 'invoice' | 'credit_note';
  number: string | null;
  issueDate: string | null;
  dueOn: string | null;
  vatTreatment: VatTreatment;
  clientVatNumber: string | null;
  currency: string;
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
  notes: string | null;
  creditsNumber?: string | null;
  client: {
    name: string;
    legalName: string | null;
    invoiceAddress: string | null;
    kvkNumber: string | null;
    countryCode: string;
    paymentTermsDays: number;
  };
  lines: Array<{
    description: string;
    quantity: string;
    unitPriceCents: number;
    amountCents: number;
    vatRate: string;
  }>;
}

const euro = (cents: number, currency = 'EUR') =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency }).format(cents / 100);

const date = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('nl-NL', { dateStyle: 'long' }).format(new Date(iso)) : '—';

/**
 * The invoice PDF.
 *
 * Rendered at issue time and stored through Document Management, so what was sent can be
 * reproduced exactly seven years later — regeneration is for draft previews only.
 * Deliberately plain: an invoice is a legal document, and legibility beats branding.
 */
export function renderInvoicePdf(invoice: RenderableInvoice, org: OrgSettings): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const title =
      invoice.kind === 'credit_note'
        ? `Creditnota ${invoice.number ?? '(concept)'}`
        : invoice.number
          ? `Factuur ${invoice.number}`
          : 'CONCEPT — geen factuur';

    // ── header: who is sending this ──
    doc.fontSize(18).font('Helvetica-Bold').text(org.legalName || 'Finsera');
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#444444')
      .text([org.addressLine1, org.addressLine2].filter(Boolean).join(', '))
      .text(`KvK ${org.kvkNumber || '—'} · BTW ${org.vatNumber || '—'}`)
      .text(`IBAN ${org.iban || '—'}${org.invoiceEmail ? ` · ${org.invoiceEmail}` : ''}`);

    doc.moveDown(1.5);
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#000000').text(title);
    if (invoice.creditsNumber) {
      doc.fontSize(9).font('Helvetica').text(`Betreft factuur ${invoice.creditsNumber}`);
    }
    doc.moveDown(0.75);

    // ── the two-column block: dates and the client ──
    const y = doc.y;
    doc
      .fontSize(9)
      .font('Helvetica')
      .text(`Factuurdatum: ${date(invoice.issueDate)}`, 50, y)
      .text(`Vervaldatum: ${date(invoice.dueOn)}`)
      .text(`Betaaltermijn: ${invoice.client.paymentTermsDays} dagen`);

    doc
      .font('Helvetica-Bold')
      .text(invoice.client.legalName || invoice.client.name, 320, y)
      .font('Helvetica');
    if (invoice.client.invoiceAddress) doc.text(invoice.client.invoiceAddress, 320);
    if (invoice.client.kvkNumber) doc.text(`KvK ${invoice.client.kvkNumber}`, 320);
    if (invoice.clientVatNumber) doc.text(`BTW ${invoice.clientVatNumber}`, 320);

    doc.moveDown(2);

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
    for (const line of invoice.lines) {
      doc.text(line.description, col.desc, rowY, { width: 270 });
      doc.text(line.quantity, col.qty, rowY, { width: 50, align: 'right' });
      doc.text(euro(line.unitPriceCents, invoice.currency), col.rate, rowY, {
        width: 70,
        align: 'right',
      });
      doc.text(euro(line.amountCents, invoice.currency), col.amount, rowY, {
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
      doc.text(euro(cents, invoice.currency), col.amount, rowY, { width: 75, align: 'right' });
      rowY += 14;
    };
    totalRow('Subtotaal', invoice.subtotalCents);
    totalRow(
      invoice.vatTreatment === 'domestic_21' ? 'BTW 21%' : 'BTW 0%',
      invoice.vatCents,
    );
    totalRow('Totaal', invoice.totalCents, true);

    // ── the legally required legend, when the treatment demands one ──
    const legend = vatLegend(invoice.vatTreatment);
    if (legend) {
      rowY += 6;
      doc.font('Helvetica-Oblique').fontSize(9).text(legend, 50, rowY, { width: 495 });
      rowY = doc.y;
    }

    if (invoice.notes) {
      rowY += 10;
      doc.font('Helvetica').fontSize(9).text(invoice.notes, 50, rowY, { width: 495 });
      rowY = doc.y;
    }

    if (invoice.kind === 'invoice' && invoice.number) {
      rowY += 16;
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#444444')
        .text(
          `Gelieve ${euro(invoice.totalCents, invoice.currency)} over te maken op ${
            org.iban || 'de vermelde rekening'
          } onder vermelding van ${invoice.number}.`,
          50,
          rowY,
          { width: 495 },
        );
    }

    doc.end();
  });
}

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * UBL 2.1 — the e-invoice XML any Dutch accounting package can import (decision §11:
 * UBL now, a package API later without touching the invoice itself).
 */
export function renderInvoiceUbl(invoice: RenderableInvoice, org: OrgSettings): string {
  if (!invoice.number || !invoice.issueDate) {
    throw new Error('Only issued invoices can be exported as UBL');
  }
  const currency = invoice.currency;
  const money = (cents: number) => (cents / 100).toFixed(2);
  const typeCode = invoice.kind === 'credit_note' ? 381 : 380;
  const vatCategory =
    invoice.vatTreatment === 'domestic_21' ? 'S' : invoice.vatTreatment === 'reverse_charge' ? 'AE' : 'G';
  const vatPercent = invoice.vatTreatment === 'domestic_21' ? '21.00' : '0.00';

  const lines = invoice.lines
    .map(
      (line, i) => `
  <cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="HUR">${escapeXml(line.quantity)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${currency}">${money(line.amountCents)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${escapeXml(line.description)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${vatCategory}</cbc:ID>
        <cbc:Percent>${line.vatRate}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${currency}">${money(line.unitPriceCents)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`,
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:ID>${escapeXml(invoice.number)}</cbc:ID>
  <cbc:IssueDate>${invoice.issueDate}</cbc:IssueDate>
  ${invoice.dueOn ? `<cbc:DueDate>${invoice.dueOn}</cbc:DueDate>` : ''}
  <cbc:InvoiceTypeCode>${typeCode}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>${escapeXml(org.legalName)}</cbc:Name></cac:PartyName>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(org.vatNumber)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(org.legalName)}</cbc:RegistrationName>
        <cbc:CompanyID schemeID="NL:KVK">${escapeXml(org.kvkNumber)}</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>${escapeXml(invoice.client.legalName || invoice.client.name)}</cbc:Name></cac:PartyName>
      ${
        invoice.clientVatNumber
          ? `<cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(invoice.clientVatNumber)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>`
          : ''
      }
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>
    <cbc:PaymentID>${escapeXml(invoice.number)}</cbc:PaymentID>
    <cac:PayeeFinancialAccount><cbc:ID>${escapeXml(org.iban)}</cbc:ID></cac:PayeeFinancialAccount>
  </cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currency}">${money(invoice.vatCents)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${currency}">${money(invoice.subtotalCents)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${currency}">${money(invoice.vatCents)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${vatCategory}</cbc:ID>
        <cbc:Percent>${vatPercent}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currency}">${money(invoice.subtotalCents)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${currency}">${money(invoice.subtotalCents)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${currency}">${money(invoice.totalCents)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${currency}">${money(invoice.totalCents)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lines}
</Invoice>`;
}
