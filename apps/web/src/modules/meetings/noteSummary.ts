/**
 * Whether a note has been written in, and what it first says.
 *
 * Its own module because it is pure and worth testing on its own: NoteList reaches the auth
 * client through `api.ts` the moment it is imported, so a spec for these two functions could
 * not load the component that used to hold them without a browser to hold the auth client.
 */
/**
 * The first thing the note actually says.
 *
 * Headings do not count. Every ceremony body starts life as the template's skeleton — `##
 * Round the table`, `## Blockers` — so a summary taken from line one would report the
 * skeleton back as content, and every unwritten stand-up in the database would look written.
 * That distinction is the single most useful thing this list can draw: of the ceremony notes
 * held so far, the bodies are still the headings they were seeded with.
 */
export function saidSomething(body: string): string | null {
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;
    // The rule under the letterhead, and any other the writer used to break the page up.
    if (/^([-*_])\1{2,}$/.test(line.replace(/\s+/g, ''))) continue;
    /*
     * The tables the templates are seeded with.
     *
     * A skeleton table is three lines of scaffolding — `| Risk | Impact | What we do |`, the
     * `| --- |` under it, and an empty row — and all three read as prose to the stripping
     * below. Left alone, every untouched kick-off in the list would summarise itself as
     * "Risk Impact What we do", which is the flattery this function exists to refuse.
     *
     * The header row is recognised by what follows it rather than by what it says, because
     * what it says is the one part a template author is free to change. A row with anything
     * typed into it is content and falls through, which is the whole point: the moment
     * somebody fills a cell in, the note has said something.
     */
    if (line.startsWith('|')) {
      const cells = line.split('|').slice(1, -1);
      const separator = cells.every((c) => /^\s*:?-{3,}:?\s*$/.test(c));
      const empty = cells.every((c) => !plainText(c.trim()));
      const heads = separator || (lines[i + 1] ?? '').trim().startsWith('| --- ');
      if (separator || empty || heads) continue;
      /*
       * A filled row, read out rather than shown.
       *
       * Falling through to the stripping below would summarise the note as
       * `| Credentials are late | Sprint 1 slips | Chase Anna |` — the pipes are the table,
       * not the sentence, and in a one-line summary they are the loudest thing on the row.
       */
      return cells.map((c) => plainText(c.trim())).filter(Boolean).join(' · ');
    }
    // A bullet or checkbox with nothing after it is still an empty template.
    const stripped = line.replace(/^([-*+]|\d+\.)\s*/, '').replace(/^\[[ x]\]\s*/i, '').trim();
    if (!stripped) continue;
    /*
     * A label with nothing after it is not content either.
     *
     * The seeded stand-up puts `Yesterday:` / `Today:` / `Blockers:` under each person, and
     * reading line one meant every untouched stand-up in the database summarised itself as
     * "Yesterday:" — which is exactly the flattery this function exists to refuse. Skipping
     * the label reveals the truth underneath: nobody typed anything.
     */
    const inline = plainText(stripped);
    if (!inline || /^[^:]{0,24}:$/.test(inline)) continue;
    return inline;
  }
  return null;
}

/**
 * Markdown as a reader would hear it.
 *
 * The body is Markdown and this is one line of prose, so the marks have to go — a summary
 * reading `Needs ==urgent review==.` shows the syntax instead of the emphasis it stands for.
 * Deliberately not a parser: this only ever has to survive one line and lose no words.
 */
export function plainText(s: string) {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(\*\*|__|==|~~|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

