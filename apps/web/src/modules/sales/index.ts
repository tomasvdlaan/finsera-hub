import type { WebModule } from '../types.js';
import { QuoteChatCard } from './QuoteChatCard.js';
import { QuoteDetail } from './QuoteDetail.js';
import { QuoteList } from './QuoteList.js';

export const salesWebModule: WebModule = {
  name: 'sales',
  routes: [
    { path: '/sales', Component: QuoteList },
    { path: '/sales/quotes/:id', Component: QuoteDetail },
  ],
  chatWidgets: { quote: QuoteChatCard },
};
