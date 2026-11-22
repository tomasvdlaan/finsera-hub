import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * One page of Help, whether somebody wrote it or the manifests produced it.
 *
 * Both kinds are the same shape on purpose: search, the viewer and the assistant's tools have
 * no business knowing which is which. `kind` exists only so the viewer can say "this page is
 * generated, edit the manifest" instead of pointing at a file that does not exist.
 */
export interface HelpPage {
  /** 'time/log-hours', 'index', 'reference/permissions'. The file path without `.md`. */
  slug: string;
  title: string;
  summary: string;
  /** A manifest name, or `shell` for everything that is not a module. */
  module: string;
  /** App routes this page documents. The coverage test reads these. */
  paths: string[];
  /** The capability needed to do what the page describes, if one gates it. */
  capability?: string;
  keywords: string[];
  /** ISO date somebody last checked the page against the product. */
  updated?: string;
  kind: 'guide' | 'reference';
  /** Markdown, front matter removed. */
  body: string;
}

/** Where the written guides live. Copied next to the compiled code by nest-cli `assets`. */
export const CONTENT_DIR = join(__dirname, 'content');

/**
 * A deliberately small front-matter reader.
 *
 * The pages use four shapes — `key: text`, `key: [a, b]`, and nothing else — so a YAML library
 * would be a dependency that exists to be misused. Anything outside those shapes is an error,
 * not a guess, so a typo in a page fails the content test instead of producing a page with a
 * silently empty field.
 */
export function parseFrontMatter(raw: string, file: string): { data: Record<string, string | string[]>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing front matter`);

  const data: Record<string, string | string[]> = {};
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = line.match(/^([a-z][a-zA-Z]*):\s*(.*)$/);
    if (!kv) throw new Error(`${file}: cannot read front matter line "${line}"`);
    const key = kv[1] ?? '';
    const value = kv[2] ?? '';
    const list = value.match(/^\[(.*)\]$/);
    data[key] = list
      ? (list[1] ?? '')
          .split(',')
          .map((s) => unquote(s.trim()))
          .filter(Boolean)
      : unquote(value.trim());
  }
  return { data, body: (m[2] ?? '').trim() };
}

function unquote(s: string): string {
  const q = s.match(/^(['"])(.*)\1$/);
  return q?.[2] ?? s;
}

function* walk(dir: string): Generator<string> {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, d.name);
    if (d.isDirectory()) yield* walk(full);
    else if (d.name.endsWith('.md') && !d.name.startsWith('_')) yield full;
  }
}

const asList = (v: string | string[] | undefined): string[] =>
  Array.isArray(v) ? v : v ? [v] : [];

/**
 * Every written guide, parsed. Throws on the first malformed page, naming the file.
 *
 * Loud on purpose: a page that fails to parse and is quietly skipped is a page that is simply
 * missing from Help, and nobody finds out until someone asks the assistant about it.
 */
export function loadGuides(dir: string = CONTENT_DIR): HelpPage[] {
  const pages: HelpPage[] = [];
  for (const file of walk(dir)) {
    const rel = relative(dir, file).split('\\').join('/');
    const slug = rel.replace(/\.md$/, '');
    const { data, body } = parseFrontMatter(readFileSync(file, 'utf8'), rel);

    for (const required of ['title', 'summary', 'module']) {
      if (typeof data[required] !== 'string' || !data[required]) {
        throw new Error(`${rel}: front matter needs a "${required}"`);
      }
    }
    if (data.updated && !/^\d{4}-\d{2}-\d{2}$/.test(String(data.updated))) {
      throw new Error(`${rel}: "updated" must be an ISO date (YYYY-MM-DD)`);
    }

    pages.push({
      slug,
      title: data.title as string,
      summary: data.summary as string,
      module: data.module as string,
      paths: asList(data.paths),
      capability: typeof data.capability === 'string' && data.capability ? data.capability : undefined,
      keywords: asList(data.keywords),
      updated: typeof data.updated === 'string' ? data.updated : undefined,
      kind: 'guide',
      body,
    });
  }
  return pages.sort((a, b) => a.slug.localeCompare(b.slug));
}
