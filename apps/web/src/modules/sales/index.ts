import type { WebModule } from '../types.js';
import { ContractChatCard } from './ContractChatCard.js';
import { ContractDetail } from './ContractDetail.js';
import { ContractList } from './ContractList.js';
import { QuoteChatCard } from './QuoteChatCard.js';
import { QuoteDetail } from './QuoteDetail.js';
import { QuoteList } from './QuoteList.js';
import { RateCards } from './RateCards.js';

export const salesWebModule: WebModule = {
  name: 'sales',
  routes: [
    { path: '/money/quotes', Component: QuoteList, width: 'wide' },
    { path: '/money/quotes/:id', Component: QuoteDetail },
    // Before the :id route, or 'contracts' would be read as a quote id.
    { path: '/money/contracts', Component: ContractList, width: 'wide' },
    { path: '/money/contracts/:id', Component: ContractDetail },
    { path: '/money/rate-cards', Component: RateCards, width: 'read' },
  ],
  chatWidgets: { quote: QuoteChatCard, contract: ContractChatCard },
};
