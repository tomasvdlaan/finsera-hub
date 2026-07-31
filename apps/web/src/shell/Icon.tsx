/**
 * The icons the manifests have always declared and nothing ever rendered.
 *
 * Every navigation entry carries an `icon` string — 'receipt', 'clock', 'columns' — and the
 * shell dropped it on the floor, so the rail was thirteen identical lines of text and
 * scanning it meant reading it. Inline paths rather than an icon package: this is under
 * twenty glyphs, and a dependency for them would be heavier than the glyphs.
 *
 * An unknown name renders a dot rather than nothing, so a new module's icon typo shows up
 * as a missing glyph instead of a subtly narrower row.
 */
const PATHS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  receipt: 'M6 3v18l3-2 3 2 3-2 3 2V3zM9 8h6M9 12h6',
  'file-text': 'M14 3v5h5M14 3H6v18h12V8zM9 13h6M9 17h4',
  'file-signature': 'M14 3v5h5M14 3H6v18h12V8zM8 16c2-2 4 2 6 0',
  file: 'M14 3v5h5M14 3H6v18h12V8z',
  users: 'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM21 20v-1a4 4 0 0 0-3-3.9',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  columns: 'M4 4h4v16H4zM10 4h4v16h-4zM16 4h4v16h-4z',
  'bar-chart': 'M5 20V10M12 20V4M19 20v-6',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 21a2 2 0 0 1-3.4 0',
  inbox: 'M3 12h5l2 3h4l2-3h5M5 5h14l2 7v7H3v-7z',
  tag: 'M20 12 12 20l-8-8V4h8zM7.5 7.5h.01',
  search: 'M21 21l-4.3-4.3M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H7a1.6 1.6 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z',
  dot: 'M12 12h.01',

  // Added for the conversation list, where a row has room for a glyph and not for a word.
  pin: 'M9 3h6l-1 6 4 4v2H6v-2l4-4zM12 15v6',
  archive: 'M3 7h18v3H3zM5 10v10h14V10M10 14h4',
  trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6',
  pencil: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z',
  download: 'M12 4v10M8 11l4 3 4-3M4 19h16',
  star: 'm12 4 2.4 5 5.6.8-4 3.9 1 5.5-5-2.6-5 2.6 1-5.5-4-3.9 5.6-.8z',
  scissors: 'M6.5 8.5 20 20M6.5 15.5 20 4M9 6a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
  plus: 'M12 5v14M5 12h14',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  chevron: 'm9 6 6 6-6 6',
  check: 'M4 12.5 9 18 20 6',
  x: 'M6 6l12 12M18 6 6 18',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM15.5 8.5l-2 5-5 2 2-5z',
};

export function Icon({ name, size = 16 }: { name?: string; size?: number }) {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative: the label beside it already names the destination, and announcing
      // "receipt, Invoices" is worse than announcing "Invoices".
      aria-hidden="true"
    >
      <path d={PATHS[name ?? ''] ?? PATHS.dot} />
    </svg>
  );
}
