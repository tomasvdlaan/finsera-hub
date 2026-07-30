/**
 * Move transcripts out of note bodies and into meetings.transcripts.
 *
 * Live capture used to append what was said to `notes.body`. That text is what gets
 * chunked, embedded and keyword-searched, so every note that was recorded had its own
 * content buried under thousands of words of speech. Transcripts are their own rows now;
 * this moves the ones already written.
 *
 * Dry run by default. Pass --commit to write.
 *
 *   node scripts/backfill-transcripts.mjs            # report only
 *   node scripts/backfill-transcripts.mjs --commit   # move them
 *
 * Order matters: each transcript is inserted BEFORE the section is cut from the body, and
 * both happen in one transaction per note. A crash between the two would otherwise lose
 * the speech to tidy the note, which is the one outcome worse than leaving it alone.
 *
 * Chunks for touched notes are deleted rather than rebuilt — embedding needs the model and
 * this script has no business calling it. Until each note is re-indexed it is findable by
 * keyword (over the now-clean body) and not by similarity. POST /meetings/:id/reindex
 * rebuilds one.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const commit = process.argv.includes('--commit');
/** Print every parsed utterance, so a dry run can be checked rather than trusted. */
const show = process.argv.includes('--show');

const envPath = new URL('../../../.env', import.meta.url);
let url = process.env.DATABASE_URL;
if (!url) {
  try {
    url = /^DATABASE_URL=(.*)$/m.exec(readFileSync(envPath, 'utf8'))?.[1]?.trim().replace(/^["']|["']$/g, '');
  } catch {
    /* fall through to the default */
  }
}
url ??= 'postgres://platform:platform@localhost:5432/platform';

/** `## Transcript` or `## Transcript — 14:35`, at the start of a line. */
const HEADING = /^## Transcript(?:\s+—\s+(\d{1,2}):(\d{2}))?\s*$/;

/**
 * The start of one utterance: `[01:05] **Anna:** `, with the brackets optionally escaped.
 *
 * Both details come from the stored data rather than from the code that wrote it. The
 * rich-text editor round-trips the body through Markdown, and on the way back it escapes
 * `[` and `]` — they would otherwise read as a link — so what is on disk is `\[01:05\]`.
 * It also reflows the section onto a single line, because consecutive lines of Markdown
 * are one paragraph. A line-by-line parser therefore found nothing at all.
 */
const UTTERANCE = /\\?\[(\d{1,2}):(\d{2})\\?\]\s*(?:\*\*(.+?):\*\*\s*)?/g;

/** Undo the editor's Markdown escaping, so the stored text reads as it was spoken. */
const unescape = (s) => s.replace(/\\([[\]*_`~])/g, '$1').trim();

/**
 * Split a body into the parts that are notes and the transcript sections between them.
 *
 * Headings are found line by line, because a heading is genuinely a line. The utterances
 * inside a section are then found by scanning its whole text for timestamps, which is the
 * only thing that survives the editor reliably.
 */
function extract(body) {
  const sections = [];
  const kept = [];
  let current = null;

  for (const raw of body.split('\n')) {
    const heading = HEADING.exec(raw);
    if (heading) {
      current = {
        at: heading[1] ? `${heading[1].padStart(2, '0')}:${heading[2]}` : null,
        text: '',
      };
      sections.push(current);
      continue;
    }
    // Any other h2 ends the transcript and returns us to the note.
    if (current && /^##\s/.test(raw)) {
      current = null;
      kept.push(raw);
      continue;
    }
    if (current) current.text += `${raw}\n`;
    else kept.push(raw);
  }

  for (const section of sections) {
    const marks = [...section.text.matchAll(UTTERANCE)];
    section.lines = marks.map((m, i) => {
      const from = m.index + m[0].length;
      const to = i + 1 < marks.length ? marks[i + 1].index : section.text.length;
      return {
        at: Number(m[1]) * 60 + Number(m[2]),
        speaker: m[3] || undefined,
        text: unescape(section.text.slice(from, to)),
      };
    }).filter((l) => l.text);
  }

  return {
    sections: sections.filter((s) => s.lines.length > 0),
    body: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
  };
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const { rows: notes } = await client.query(`
  SELECT id, title, meeting_date, transcribed_at, body
    FROM meetings.notes
   WHERE body LIKE '%## Transcript%'
   ORDER BY created_at`);

console.log(`${notes.length} note(s) with a transcript in the body${commit ? '' : ' (dry run)'}\n`);

let moved = 0;
for (const note of notes) {
  const { sections, body } = extract(note.body);
  if (sections.length === 0) {
    console.log(`- ${note.title}: heading but no parsable lines — left alone`);
    continue;
  }

  const saved = sections.reduce((n, s) => n + s.lines.length, 0);
  console.log(
    `- ${note.title}: ${sections.length} recording(s), ${saved} line(s), ` +
      `body ${note.body.length} → ${body.length} chars`,
  );

  if (show) {
    for (const [i, section] of sections.entries()) {
      console.log(`    recording ${i + 1}${section.at ? ` at ${section.at}` : ' (no time in the heading)'}`);
      for (const l of section.lines) {
        const mm = String(Math.floor(l.at / 60)).padStart(2, '0');
        const ss = String(l.at % 60).padStart(2, '0');
        console.log(`      [${mm}:${ss}] ${l.speaker ?? '?'}: ${l.text}`);
      }
    }
    console.log(`    body left behind: ${JSON.stringify(body)}`);
  }

  if (!commit) continue;

  await client.query('BEGIN');
  try {
    for (const [index, section] of sections.entries()) {
      // The only start time available is the wall clock in the heading, and the older
      // sections have none. Anchoring to the meeting date is the honest reading; it is a
      // date the meeting certainly happened on.
      const startedAt = section.at
        ? `${note.meeting_date} ${section.at}:00`
        : (note.transcribed_at ?? `${note.meeting_date} 00:00:00`);

      await client.query(
        `INSERT INTO meetings.transcripts
           (id, note_id, started_at, duration_seconds, provider, lines, tokens, cost_cents)
         VALUES (gen_random_uuid(), $1, $2, $3, 'backfilled', $4::jsonb, 0, 0)`,
        [
          note.id,
          startedAt,
          section.lines.length > 0 ? section.lines[section.lines.length - 1].at : 0,
          JSON.stringify(
            section.lines.map((l, i) => ({
              id: `${note.id}-backfill-${index}-${i}`,
              at: l.at,
              text: l.text,
              ...(l.speaker ? { speaker: l.speaker } : {}),
            })),
          ),
        ],
      );
    }

    await client.query('UPDATE meetings.notes SET body = $2 WHERE id = $1', [note.id, body]);
    // Stale: they were embedded with the speech in them.
    await client.query('DELETE FROM meetings.note_chunks WHERE note_id = $1', [note.id]);
    await client.query('COMMIT');
    moved += sections.length;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`  ! ${note.title} left untouched: ${error.message}`);
  }
}

console.log(
  commit
    ? `\nMoved ${moved} transcript(s). Re-index the touched notes to restore semantic search.`
    : '\nNothing written. Pass --commit to move them.',
);
await client.end();
