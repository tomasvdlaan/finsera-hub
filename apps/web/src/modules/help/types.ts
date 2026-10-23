export interface HelpNavEntry {
  slug: string;
  title: string;
  summary: string;
  kind: 'guide' | 'reference';
}

export interface HelpNavGroup {
  module: string;
  label: string;
  overview: HelpNavEntry | null;
  pages: HelpNavEntry[];
}

export interface HelpNav {
  start: HelpNavEntry | null;
  groups: HelpNavGroup[];
  reference: HelpNavEntry[];
}

export interface HelpHit {
  slug: string;
  title: string;
  module: string;
  kind: 'guide' | 'reference';
  heading: string;
  anchor: string;
  snippet: string;
  score: number;
}

export interface HelpPageData {
  slug: string;
  title: string;
  summary: string;
  module: string;
  paths: string[];
  capability?: string;
  keywords: string[];
  updated?: string;
  kind: 'guide' | 'reference';
  body: string;
}
