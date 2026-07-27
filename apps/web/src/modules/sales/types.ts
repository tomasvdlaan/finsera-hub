export interface QuoteLine {
  id: string;
  position: number;
  description: string;
  quantity: string;
  unitPriceCents: number;
  amountCents: number;
  vatRate: string;
  unit: 'hours' | 'days' | 'fixed';
}

export interface Quote {
  id: string;
  number: string | null;
  status: 'draft' | 'sent' | 'accepted' | 'rejected';
  clientId: string;
  projectId: string | null;
  projectCreatedId: string | null;
  supersedesQuoteId: string | null;
  version: number;
  title: string;
  introduction: string | null;
  notes: string | null;
  vatTreatment: 'domestic_21' | 'reverse_charge' | 'outside_eu';
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
  hourlyRateCents: number | null;
  billingModel: 'time_and_materials' | 'fixed_fee' | 'retainer';
  issueDate: string | null;
  validUntil: string | null;
  pdfDocumentId: string | null;
  /** Derived server-side from today, never stored. */
  expired: boolean;
  open: boolean;
}

export interface QuoteDetail extends Quote {
  lines: QuoteLine[];
  vatLegend: string | null;
}

export const money = (cents: number, currency = 'EUR') =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency }).format(cents / 100);

export const UNIT_LABELS: Record<QuoteLine['unit'], string> = {
  hours: 'uur',
  days: 'dagen',
  fixed: 'vast',
};
