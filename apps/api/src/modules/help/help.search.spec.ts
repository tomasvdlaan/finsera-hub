import { describe, expect, it } from 'vitest';
import { parseFrontMatter } from './help.content.js';
import type { HelpPage } from './help.content.js';
import { HelpIndex, sectionsOf, slugifyHeading, tokenize } from './help.search.js';

const page = (over: Partial<HelpPage> & Pick<HelpPage, 'slug' | 'title' | 'body'>): HelpPage => ({
  summary: '',
  module: 'x',
  paths: [],
  keywords: [],
  kind: 'guide',
  ...over,
});

const PAGES: HelpPage[] = [
  page({
    slug: 'billing/send-invoice',
    title: 'Send an invoice',
    summary: 'Turn a draft into something the client can pay.',
    keywords: ['bill', 'ubl'],
    body: 'Open the invoice.\n\n## Steps\n1. Click **Send**.\n\n## Good to know\nSent invoices are numbered and locked.',
  }),
  page({
    slug: 'time/approve-week',
    title: 'Approve a week',
    summary: 'Sign off a colleague’s hours.',
    keywords: ['timesheet'],
    body: 'Administrators approve weeks.\n\n## Steps\n1. Open **Approvals**.',
  }),
  page({
    slug: 'time/log-hours',
    title: 'Log your hours',
    summary: 'Track time on a project.',
    keywords: ['timer', 'timesheet'],
    body: 'Start the timer or type minutes.\n\n## Good to know\nInvoices use approved hours only.',
  }),
];

describe('help search', () => {
  const index = new HelpIndex(PAGES);

  it('finds a page by the words in its title, ignoring filler', () => {
    expect(index.search('how do I send an invoice')[0]?.slug).toBe('billing/send-invoice');
  });

  it('finds a page by a keyword the page itself never says', () => {
    expect(index.search('ubl')[0]?.slug).toBe('billing/send-invoice');
    expect(index.search('timer')[0]?.slug).toBe('time/log-hours');
  });

  it('matches plurals and half-typed words', () => {
    expect(index.search('invoices')[0]?.slug).toBe('billing/send-invoice');
    expect(index.search('approv')[0]?.slug).toBe('time/approve-week');
  });

  it('ranks the page about a thing above a page that merely mentions it', () => {
    const hits = index.search('invoice');
    expect(hits[0]?.slug).toBe('billing/send-invoice');
    expect(hits.some((h) => h.slug === 'time/log-hours')).toBe(true);
  });

  it('prefers a page that covers the whole question', () => {
    expect(index.search('approve week')[0]?.slug).toBe('time/approve-week');
  });

  it('points a hit at the section that matched', () => {
    const hit = index.search('numbered locked')[0];
    expect(hit?.slug).toBe('billing/send-invoice');
    expect(hit?.anchor).toBe('good-to-know');
  });

  it('returns nothing, not noise, for words it does not know', () => {
    expect(index.search('zebra')).toEqual([]);
    expect(index.search('   ')).toEqual([]);
    expect(index.search('the a of')).toEqual([]);
  });
});

describe('help text handling', () => {
  it('splits a page at ## headings and keeps the introduction', () => {
    const [intro, steps] = sectionsOf(PAGES[0]!);
    expect(intro?.anchor).toBe('');
    expect(steps?.heading).toBe('Steps');
    expect(steps?.anchor).toBe('steps');
  });

  it('slugs headings the way the web viewer does', () => {
    expect(slugifyHeading('Good to know')).toBe('good-to-know');
    expect(slugifyHeading('Before you start: **read** this')).toBe('before-you-start-read-this');
  });

  it('tokenises with light stemming', () => {
    expect(tokenize('Logging invoices')).toEqual(['log', 'invoic']);
  });

  it('reads front matter, and refuses what it cannot read', () => {
    const ok = parseFrontMatter('---\ntitle: Hi\nkeywords: [a, "b c"]\n---\nBody', 'x.md');
    expect(ok.data).toEqual({ title: 'Hi', keywords: ['a', 'b c'] });
    expect(ok.body).toBe('Body');
    expect(() => parseFrontMatter('no front matter', 'x.md')).toThrow(/front matter/);
    expect(() => parseFrontMatter('---\n- not valid\n---\nx', 'x.md')).toThrow(/cannot read/);
  });
});
