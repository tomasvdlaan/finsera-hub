import type { WebModule } from '../types.js';
import { InvoiceChatCard } from './InvoiceChatCard.js';
import { InvoiceDetail } from './InvoiceDetail.js';
import { InvoiceList } from './InvoiceList.js';

export const billingWebModule: WebModule = {
  name: 'billing',
  routes: [
    { path: '/money/invoices', Component: InvoiceList, width: 'wide' },
    { path: '/money/invoices/:id', Component: InvoiceDetail },
  ],
  chatWidgets: { invoice: InvoiceChatCard },
};
