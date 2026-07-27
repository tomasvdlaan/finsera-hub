export const CONTRACT_TYPES = ['framework', 'sow', 'nda', 'dpa', 'other'] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export const TYPE_LABELS: Record<ContractType, string> = {
  framework: 'Raamovereenkomst',
  sow: 'Opdrachtbevestiging',
  nda: 'NDA',
  dpa: 'Verwerkersovereenkomst',
  other: 'Overig',
};

export interface Contract {
  id: string;
  clientId: string;
  projectId: string | null;
  type: ContractType;
  status: 'draft' | 'signed' | 'terminated';
  title: string;
  reference: string | null;
  documentId: string | null;
  startsOn: string | null;
  endsOn: string | null;
  noticeDays: number | null;
  autoRenews: 'yes' | 'no';
  renewalMonths: number | null;
  allowsSubProcessors: 'yes' | 'no' | 'unclear' | null;
  notes: string | null;
  signedAt: string | null;
  terminatedAt: string | null;
  /** All derived server-side from today; none of them stored. */
  expired: boolean;
  daysUntilEnd: number | null;
  noticeDeadline: string | null;
  inNoticeWindow: boolean;
  noticeClosingSoon: boolean;
  expiringSoon: boolean;
}

export interface RateCardLine {
  id: string;
  role: string;
  rateCents: number;
  effectiveFrom: string;
}

export interface RateCard {
  id: string;
  clientId: string | null;
  contractId: string | null;
  name: string;
  currency: string;
  lines: RateCardLine[];
  /** The rate per role in force today. */
  currentRates: RateCardLine[];
}
