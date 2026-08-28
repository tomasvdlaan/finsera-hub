-- What a document is about, as opposed to what it is called.
--
-- Everything here is derived, and that is the point of keeping it out of the columns that
-- describe the file. `title` is what somebody typed; these are what a model read.
ALTER TABLE docs.documents
  -- One paragraph, written when the text is indexed. The pipeline already reads every word to
  -- chunk and embed it, so this costs one extra call on a path that was already going to run.
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS summarised_at timestamptz,

  -- The two extracted facts worth querying as columns rather than burying in jsonb: "every
  -- quote over five thousand" is a question somebody will ask, and it cannot be asked of a
  -- json blob without a scan.
  ADD COLUMN IF NOT EXISTS doc_type text,
  ADD COLUMN IF NOT EXISTS value_cents bigint,

  -- The long tail — payment terms, notice periods, dates, counterparty. Shapes differ per
  -- document kind and a column per term would be a migration every time a new kind arrives.
  ADD COLUMN IF NOT EXISTS terms jsonb,
  ADD COLUMN IF NOT EXISTS extracted_at timestamptz;

-- A value with no sign convention is a value nobody can add up.
ALTER TABLE docs.documents
  ADD CONSTRAINT documents_value_sane CHECK (value_cents IS NULL OR value_cents >= 0);

-- Extraction is a claim about a document, so it is only true of the version it read. A
-- timestamp without one would survive a v2 upload and describe the wrong file.
ALTER TABLE docs.documents
  ADD COLUMN IF NOT EXISTS extracted_version_id uuid;
