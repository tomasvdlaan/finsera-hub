export const CLIENT_STATUSES = ['lead', 'proposal', 'active', 'dormant', 'lost'] as const;
export const PROJECT_STATUSES = [
  'prospective',
  'active',
  'on_hold',
  'completed',
  'cancelled',
] as const;
export const BILLING_MODELS = ['time_and_materials', 'fixed_fee', 'retainer'] as const;
export const RETAINER_PERIODS = ['monthly', 'quarterly', 'annual'] as const;

export type ClientStatus = (typeof CLIENT_STATUSES)[number];
export type BillingModel = (typeof BILLING_MODELS)[number];

export interface Client {
  id: string;
  name: string;
  status: ClientStatus;
  ownerId: string | null;
  website: string | null;
  notes: string | null;
  legalName: string | null;
  invoiceAddress: string | null;
  kvkNumber: string | null;
  vatNumber: string | null;
  countryCode: string;
  vatTreatment: 'domestic_21' | 'reverse_charge' | 'outside_eu';
  paymentTermsDays: number;
  invoiceEmail: string | null;
}

export interface Contact {
  id: string;
  clientId: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  isPrimary: boolean;
}

export interface Project {
  id: string;
  clientId: string;
  name: string;
  status: string;
  currency: string;
  billingModel: BillingModel;
  defaultRateCents: number | null;
  budgetAmountCents: number | null;
  budgetHours: string | null;
  retainerAmountCents: number | null;
  retainerPeriod: string | null;
  startsOn: string | null;
  endsOn: string | null;
  /**
   * Who is on it — present only when the list was asked for with `withMembers=true`.
   *
   * Optional rather than defaulted to an empty array, so "nobody is on this" and "we did not
   * ask" stay different facts. A row that renders "nobody yet" for the second is wrong.
   */
  members?: Array<{ userId: string; role: 'lead' | 'contributor'; displayName: string }>;
}

/** Money is stored as integer cents; formatting is the only place it becomes decimal. */
export function formatMoney(cents: number | null | undefined, currency = 'EUR'): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency }).format(cents / 100);
}

export const humanise = (s: string) => s.replace(/_/g, ' ');
