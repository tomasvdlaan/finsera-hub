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
    { path: '/sales', Component: QuoteList },
    { path: '/sales/quotes/:id', Component: QuoteDetail },
    // Before the :id route, or 'contracts' would be read as a quote id.
    { path: '/sales/contracts', Component: ContractList },
    { path: '/sales/contracts/:id', Component: ContractDetail },
    { path: '/sales/rate-cards', Component: RateCards },
  ],
  chatWidgets: { quote: QuoteChatCard, contract: ContractChatCard },
};
