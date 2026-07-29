import { defineManifest } from '@platform/contracts';
import { z } from 'zod';

export const salesManifest = defineManifest({
  name: 'sales',
  version: '0.1.0',

  entities: [
    { type: 'quote', displayTemplate: '{number}', urlPattern: '/sales/quotes/:id' },
    { type: 'contract', displayTemplate: '{title}', urlPattern: '/sales/contracts/:id' },
  ],

  structuralRefs: [
    { from: 'quote', toType: 'client', required: true },
    { from: 'quote', toType: 'project', required: false },
    { from: 'contract', toType: 'client', required: true },
    { from: 'contract', toType: 'project', required: false },
  ],

  publishes: [
    { name: 'quote.sent', description: 'A quote was sent and numbered.' },
    { name: 'quote.accepted', description: 'A client accepted a quote.' },
    { name: 'quote.rejected', description: 'A client rejected a quote.' },
    { name: 'contract.signed', description: 'A contract was signed and its terms frozen.' },
    // contract.expiring is deliberately absent: it needs something to notice the day it
    // becomes true, and scheduled proactivity belongs to Phase 6's insight service.
  ],

  subscribes: [],

  permissions: [
    { capability: 'sales.quotes.read', description: 'View quotes.' },
    { capability: 'sales.quotes.write', description: 'Draft, send and decide on quotes.' },
    { capability: 'sales.contracts.read', description: 'View contracts and rate cards.' },
    {
      capability: 'sales.contracts.write',
      description: 'Record contracts, sign them, and manage rate cards.',
    },
  ],

  navigation: [
    { label: 'Quotes', path: '/sales', icon: 'file-text', section: 'money', order: 2 },
    { label: 'Contracts', path: '/sales/contracts', icon: 'file-signature', section: 'money', order: 3 },
    { label: 'Rate cards', path: '/sales/rate-cards', icon: 'tag', section: 'setup', order: 2 },
  ],
  widgets: [
    { slot: 'entity-page', component: 'sales:client-quotes' },
    { slot: 'entity-page', component: 'sales:client-contracts' },
  ],
  chatWidgets: [
    { entityType: 'quote', component: 'sales:quote-card' },
    { entityType: 'contract', component: 'sales:contract-card' },
  ],

  reportingViews: [
    {
      view: 'sales.v_quotes',
      description: 'Quotes with totals, status, version and derived expiry.',
    },
    {
      view: 'sales.v_contracts',
      description: 'Contracts with type, dates, notice period and derived days until end.',
    },
  ],

  /**
   * Sent quotes, with their lines — a quote a client cannot read the lines of is not a
   * quote they can accept. Contracts are deliberately absent: signed terms belong in a
   * conversation, not behind a login, until someone asks for them there.
   */
  portalExposure: [
    {
      entityType: 'quote',
      fields: [
        'id', 'number', 'title', 'status', 'issue_date', 'valid_until',
        'subtotal_cents', 'vat_cents', 'total_cents', 'expired',
      ],
    },
    {
      entityType: 'quote_line',
      fields: ['description', 'quantity', 'unit', 'unit_price_cents', 'amount_cents'],
    },
  ],

  aiTools: [
    {
      name: 'sales_list_quotes',
      description:
        'List quotes, optionally filtered by status (draft, sent, accepted, rejected) or client.',
      inputSchema: z.object({
        status: z.string().optional(),
        clientId: z.string().uuid().optional(),
      }),
      outputSchema: z.object({}),
      permission: 'sales.quotes.read',
      riskClass: 'read',
      handler: 'listQuotes',
    },
    {
      name: 'sales_draft_quote',
      description:
        'Draft a quote for a client from a described scope. Returns a DRAFT for review — it does not send anything. Prices are estimates the user must confirm.',
      inputSchema: z.object({
        clientId: z.string().uuid(),
        title: z.string(),
        introduction: z.string().optional(),
        lines: z
          .array(
            z.object({
              description: z.string(),
              quantity: z.string().describe('Exact decimal, e.g. "24.00" hours'),
              unitPriceCents: z.number().int().describe('Unit price in whole cents'),
              unit: z.enum(['hours', 'days', 'fixed']).optional(),
            }),
          )
          .min(1),
      }),
      outputSchema: z.object({}),
      permission: 'sales.quotes.write',
      riskClass: 'write:draft',
      handler: 'createDraft',
    },
    {
      // Declared so the boundary is visible on the platform page; the orchestrator never
      // offers restricted tools. Sending a client-facing commercial document is not
      // delegable, the same position taken for invoices (§8).
      name: 'sales_send_quote',
      description:
        'Send a quote to a client. Restricted: client-facing commercial documents are never sent by the assistant.',
      inputSchema: z.object({ quoteId: z.string().uuid() }),
      outputSchema: z.object({}),
      permission: 'sales.quotes.write',
      riskClass: 'restricted',
      handler: 'sendQuote',
    },
    {
      name: 'sales_list_contracts',
      description:
        'List contracts, optionally by client or type (framework, sow, nda, dpa, other). Includes end dates and notice periods.',
      inputSchema: z.object({
        clientId: z.string().uuid().optional(),
        type: z.enum(['framework', 'sow', 'nda', 'dpa', 'other']).optional(),
      }),
      outputSchema: z.object({}),
      permission: 'sales.contracts.read',
      riskClass: 'read',
      handler: 'listContracts',
    },
    {
      name: 'sales_draft_contract_terms',
      description:
        'Record a contract from terms found in an uploaded document. Returns an UNSIGNED draft for confirmation. Only state terms actually found in the document — never infer a standard notice period or end date that is not written there.',
      inputSchema: z.object({
        clientId: z.string().uuid(),
        type: z.enum(['framework', 'sow', 'nda', 'dpa', 'other']),
        title: z.string(),
        documentId: z.string().uuid().optional(),
        startsOn: z.string().optional().describe('ISO date, only if stated'),
        endsOn: z.string().optional().describe('ISO date, only if stated'),
        noticeDays: z.number().int().optional().describe('Only if stated'),
        allowsSubProcessors: z.enum(['yes', 'no', 'unclear']).optional(),
        notes: z.string().optional(),
      }),
      outputSchema: z.object({}),
      permission: 'sales.contracts.write',
      riskClass: 'write:draft',
      handler: 'createContract',
    },
  ],
});
