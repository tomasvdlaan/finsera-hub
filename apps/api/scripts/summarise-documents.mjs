/**
 * Write a summary for every document filed before summaries existed.
 *
 * `indexVersion` now writes one on the way past, so anything uploaded from here on gets a
 * summary for free. Everything already in the store was indexed by the old path and has a
 * null summary — which renders on the overview as "Not summarised yet", correct and useless.
 *
 * Dry run by default. Pass --commit to write.
 *
 *   node scripts/summarise-documents.mjs            # list what would be written
 *   node scripts/summarise-documents.mjs --commit   # write them
 *
 * Talks to the model directly rather than booting Nest and calling DocsService, because the
 * only thing needed is the extracted text — which is already a column — and the only thing
 * produced is one paragraph. Booting the whole application context to reach one method would
 * pull in the event bus, the scheduler and every module's boot-time registration for a job
 * that touches one table.
 *
 * Deliberately not re-embedding. Chunks are unchanged by this — the text has not moved — and
 * re-embedding a document costs real money for no difference. `POST /docs/documents/:id/reindex`
 * exists for when the text itself changes.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const commit = process.argv.includes('--commit');

const envFile = new URL('../../../.env', import.meta.url);
const env = (() => {
  try {
    return readFileSync(envFile, 'utf8');
  } catch {
    return '';
  }
})();
const fromEnv = (key) =>
  process.env[key] ?? new RegExp(`^${key}=(.*)$`, 'm').exec(env)?.[1]?.trim().replace(/^["']|["']$/g, '');

const url = fromEnv('DATABASE_URL') ?? 'postgres://platform:platform@localhost:5432/platform';
const googleKey = fromEnv('GOOGLE_GENERATIVE_AI_API_KEY');
const anthropicKey = fromEnv('ANTHROPIC_API_KEY');

/*
 * The model the application is configured with, not one written into this file.
 *
 * The first version hardcoded `gemini-2.0-flash`, which had been retired — every document
 * failed with a 404. MODEL_FAST is the same variable the service reads, so this script cannot
 * drift from the app it is backfilling for.
 */
const [provider, model] = (fromEnv('MODEL_FAST') ?? 'anthropic:claude-haiku-4-5-20251001').split(':');
const useGoogle = provider === 'google' ? Boolean(googleKey) : false;

if (commit && !googleKey && !anthropicKey) {
  console.error('No model key in the environment — nothing can be summarised.');
  process.exit(1);
}

/**
 * The same instruction the service uses.
 *
 * Kept in step by hand, which is a real cost and the alternative is worse: importing it would
 * mean this script compiles the TypeScript application to read one string.
 */
const SYSTEM =
  'You summarise business documents for a Dutch BI consultancy. Be specific about amounts, ' +
  'parties and dates when the document states them, and say nothing the document does not. ' +
  'Never guess a figure. Write in English whatever the source language.';

async function summarise(text) {
  if (useGoogle) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${googleKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text:
                    'Two or three sentences on what this document is and what it commits ' +
                    `anyone to.\n\n${text.slice(0, 12_000)}`,
                },
              ],
            },
          ],
        }),
      },
    );
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const body = await res.json();
    return body.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content:
            'Two or three sentences on what this document is and what it commits anyone to.\n\n' +
            text.slice(0, 12_000),
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const body = await res.json();
  return body.content?.[0]?.text?.trim() ?? null;
}

const pool = new pg.Pool({ connectionString: url });

const { rows } = await pool.query(`
  SELECT d.id, d.title, v.extracted_text AS text
    FROM docs.documents d
    JOIN docs.versions v ON v.id = d.current_version_id
   WHERE d.summary IS NULL
     AND d.archived_at IS NULL
     AND v.extracted_text IS NOT NULL
     AND length(btrim(v.extracted_text)) >= 200
   ORDER BY d.created_at
`);

if (rows.length === 0) {
  console.log('Every document with readable text already has a summary.');
  await pool.end();
  process.exit(0);
}

console.log(`${rows.length} document(s) with no summary${commit ? '' : ' — dry run, nothing written'}\n`);

let written = 0;
for (const row of rows) {
  if (!commit) {
    console.log(`  ${row.title}  (${row.text.length.toLocaleString()} chars)`);
    continue;
  }
  try {
    const summary = await summarise(row.text);
    if (!summary) {
      console.log(`  ${row.title} → model returned nothing`);
      continue;
    }
    await pool.query('UPDATE docs.documents SET summary = $1, summarised_at = now() WHERE id = $2', [
      summary,
      row.id,
    ]);
    written += 1;
    console.log(`  ${row.title}\n    ${summary}\n`);
  } catch (e) {
    // One document that will not summarise must not stop the other thirty-nine.
    console.log(`  ${row.title} → failed: ${e.message}`);
  }
}

if (commit) console.log(`\nWrote ${written} of ${rows.length}.`);
await pool.end();
