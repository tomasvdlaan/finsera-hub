import type { HelpPage } from './help.content.js';

/**
 * Keyword search over Help, in memory.
 *
 * A few hundred sections do not need a database, an index or an embedding call, and this has
 * to work in tests and on a fresh checkout with nothing configured. The assistant calls it
 * too, and a model is good at rephrasing a query that found nothing — so the job here is to be
 * predictable, not clever.
 *
 * Scoring is BM25-shaped: rarer words count for more, repeated words count for less, and
 * where a word appears matters — title and keywords outweigh headings, which outweigh the
 * body. A section that matches *every* word in the query beats one that matches a rare word
 * once.
 */

export interface Section {
  slug: string;
  title: string;
  module: string;
  kind: HelpPage['kind'];
  /** Text of the `##` heading, or the page title for the introduction. */
  heading: string;
  /** What the viewer jumps to. Same slug rule as the heading renderer on the web. */
  anchor: string;
  text: string;
}

export interface SearchHit {
  slug: string;
  title: string;
  module: string;
  kind: HelpPage['kind'];
  heading: string;
  anchor: string;
  snippet: string;
  score: number;
}

const STOP = new Set(
  'a an and are as at be by can do does for from how i in is it my of on or the to what when where which who why with you your me we us our there this that these those into onto about'.split(
    ' ',
  ),
);

/** The slug rule shared with the web viewer, so a search hit can scroll to its heading. */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Light stemming: enough that "invoices" finds "invoice" and "logging" finds "log", not a
 * linguistics project. Over-stemming only widens matches, which is the safe direction here.
 */
function stem(word: string): string {
  let w = word;
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && /(s|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  // "logging" → "logg" → "log"; "approve" and "approved" meet at "approv".
  if (w.length > 3 && /([^aeiou])\1$/.test(w) && !/(ss|ll)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

/** Split a page at `##` headings. The text before the first one is the introduction. */
export function sectionsOf(page: HelpPage): Section[] {
  const out: Section[] = [];
  const base = { slug: page.slug, title: page.title, module: page.module, kind: page.kind };
  let heading = page.title;
  let lines: string[] = [];
  const flush = () => {
    const text = lines.join('\n').trim();
    if (text || out.length === 0) {
      out.push({ ...base, heading, anchor: heading === page.title ? '' : slugifyHeading(heading), text });
    }
  };
  for (const line of page.body.split('\n')) {
    const h = line.match(/^##\s+(.*)$/);
    if (h) {
      flush();
      heading = (h[1] ?? '').trim();
      lines = [];
    } else {
      lines.push(line);
    }
  }
  flush();
  return out;
}

interface Indexed {
  section: Section;
  /** word → weighted frequency */
  weights: Map<string, number>;
  length: number;
}

const W_TITLE = 6;
const W_KEYWORD = 5;
const W_HEADING = 3;
const W_SUMMARY = 2;
const W_BODY = 1;

export class HelpIndex {
  private readonly docs: Indexed[] = [];
  private readonly df = new Map<string, number>();
  private avgLength = 1;

  constructor(pages: HelpPage[]) {
    for (const page of pages) {
      const pageTitle = tokenize(page.title);
      const keywords = tokenize(page.keywords.join(' '));
      const summary = tokenize(page.summary);
      for (const section of sectionsOf(page)) {
        const weights = new Map<string, number>();
        const add = (words: string[], w: number) => {
          for (const t of words) weights.set(t, (weights.get(t) ?? 0) + w);
        };
        // Page-level fields count for every section of the page, but lightly for sections
        // other than the introduction: "timer" in a page's keywords should surface the page,
        // not every one of its sections.
        const intro = section.anchor === '';
        add(pageTitle, intro ? W_TITLE : W_TITLE / 3);
        add(keywords, intro ? W_KEYWORD : W_KEYWORD / 3);
        add(summary, intro ? W_SUMMARY : 0);
        add(tokenize(section.heading), W_HEADING);
        add(tokenize(section.text), W_BODY);
        let length = 0;
        for (const v of weights.values()) length += v;
        this.docs.push({ section, weights, length });
        for (const t of weights.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      }
    }
    this.avgLength = this.docs.reduce((n, d) => n + d.length, 0) / Math.max(1, this.docs.length);
  }

  get size(): number {
    return this.docs.length;
  }

  search(query: string, limit = 8): SearchHit[] {
    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0) return [];
    const N = this.docs.length;
    const k1 = 1.2;
    const b = 0.6;

    const scored: Array<{ doc: Indexed; score: number }> = [];
    for (const doc of this.docs) {
      let score = 0;
      let matched = 0;
      for (const term of terms) {
        // Exact stem first; a prefix match (≥3 letters) catches half-typed words and
        // "approv" → "approve", at a discount so exact matches win.
        let tf = doc.weights.get(term) ?? 0;
        let discount = 1;
        if (tf === 0 && term.length >= 3) {
          for (const [w, v] of doc.weights) {
            if (w.startsWith(term) || (w.length >= 4 && term.startsWith(w))) tf = Math.max(tf, v);
          }
          discount = 0.6;
        }
        if (tf === 0) continue;
        matched += 1;
        const n = this.df.get(term) ?? 1;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        const norm = tf / (tf + k1 * (1 - b + b * (doc.length / this.avgLength)));
        score += idf * norm * (k1 + 1) * discount;
      }
      if (matched === 0) continue;
      // Covering the whole query matters more than any single strong word.
      score *= (matched / terms.length) ** 2;
      scored.push({ doc, score });
    }
    scored.sort((a, b2) => b2.score - a.score);

    // At most two sections per page, so one long guide cannot fill the results.
    const perPage = new Map<string, number>();
    const hits: SearchHit[] = [];
    for (const { doc, score } of scored) {
      const seen = perPage.get(doc.section.slug) ?? 0;
      if (seen >= 2) continue;
      perPage.set(doc.section.slug, seen + 1);
      hits.push({
        slug: doc.section.slug,
        title: doc.section.title,
        module: doc.section.module,
        kind: doc.section.kind,
        heading: doc.section.heading,
        anchor: doc.section.anchor,
        snippet: snippetFor(doc.section.text, terms),
        score: Math.round(score * 100) / 100,
      });
      if (hits.length >= limit) break;
    }
    return hits;
  }
}

/** The window of text around the first place a query word appears. */
export function snippetFor(text: string, terms: string[], width = 220): string {
  const flat = text
    .replace(/\|/g, ' ')
    .replace(/[#>*`]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= width) return flat;
  const lower = flat.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  const start = Math.max(0, (at === -1 ? 0 : at) - 60);
  const slice = flat.slice(start, start + width).trim();
  return `${start > 0 ? '…' : ''}${slice}${start + width < flat.length ? '…' : ''}`;
}
