export interface InvoiceLine {
  id: string;
  position: number;
  description: string;
  quantity: string;
  unitPriceCents: number;
  amountCents: number;
  vatRate: string;
}

export interface Invoice {
  id: string;
  kind: 'invoice' | 'credit_note';
  number: string | null;
  status: 'draft' | 'issued' | 'paid' | 'void';
  clientId: string;
  projectId: string | null;
  creditsInvoiceId: string | null;
  vatTreatment: 'domestic_21' | 'reverse_charge' | 'outside_eu';
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
  issueDate: string | null;
  dueOn: string | null;
  paidAt: string | null;
  overdue: boolean;
  pdfDocumentId: string | null;
}

export interface InvoiceDetail extends Invoice {
  lines: InvoiceLine[];
  vatLegend: string | null;
  notes: string | null;
}

export const VAT_LABELS: Record<Invoice['vatTreatment'], string> = {
  domestic_21: '21% BTW',
  reverse_charge: 'BTW verlegd',
  outside_eu: 'buiten EU',
};

export const money = (cents: number, currency = 'EUR') =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency }).format(cents / 100);
