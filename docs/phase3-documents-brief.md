# Phase 3 Requirement Brief — Document Management & the Knowledge Layer

**Companion to:** Master Document · AI Integration Plan · Build Roadmap · Decision Log
**Status:** Draft
**Date:** July 2026

---

## 1. Why documents come before boards and invoices

Two reasons, one practical and one strategic.

**Practical:** nearly every later module produces or consumes files. Quotes become PDFs (5a),
contracts are documents (5b), invoices are PDFs (5c), meeting notes embed images (6b), the
portal shares deliverables (7). Building the file backbone now means those modules file into
something that exists. Building it later means five modules each grow their own storage and
then get retrofitted.

**Strategic:** this phase brings the **knowledge layer** — the first corpus worth embedding.
Today the assistant can answer *"how many hours on Power BI?"* because that is a structured
lookup. It cannot answer *"what did we agree about the reporting scope?"*, because that
sentence lives in a document nobody has indexed. Semantic search is what turns the assistant
from a query interface into something that remembers.

**Non-goals:** client-facing sharing (Phase 7), approval flows on deliverables (7), OCR of
scanned paper, e-signature (5a uses click-to-accept), and full document *editing* — this is
storage, versioning and retrieval, not a word processor. The WYSIWYG editor is Phase 6b.

---

## 2. Storage: the one decision that outlives the phase

Master §10 puts files in EU object storage with metadata in core. Hetzner object storage is
the decided target (D4), but no account exists yet — and that must not block the phase.

**Decision: a `StorageService` interface in core, with two drivers.**

| Driver | Used | Notes |
|---|---|---|
| `local` | development, and production until Hetzner exists | Files under a configured directory; the volume is already backed up |
| `s3` | production once Hetzner object storage is provisioned | Any S3-compatible endpoint; a config change, not a code change |

The interface is the point. Modules never touch a filesystem or an SDK — they call
`storage.put()` / `storage.get()` and receive an opaque key. Swapping drivers is one env var,
exactly as the LLM provider interface works (D6).

**Important consequence:** files are the first data the database does *not* hold. A database
backup alone no longer captures everything, so the backup story must cover the storage
directory too. That is called out in §8 rather than discovered later.

---

## 3. Entities

### 3.1 Document

The thing people refer to: "the signed NDA", "the Q3 report". It has a stable identity and a
history of versions.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | registry id — this is what gets linked and searched |
| `title` | text | defaults to the uploaded filename, editable |
| `client_id` / `project_id` | uuid? | at least one required — a document with no home is unfindable |
| `category` | text? | free text: contract, proposal, deliverable, … (not an enum; taxonomies calcify) |
| `current_version_id` | uuid | the version people mean when they say "the file" |
| `uploaded_by` | uuid | core user |
| `archived_at` | timestamptz? | soft delete, mirrored to the registry |

### 3.2 Document version

Every upload creates a version; nothing is ever overwritten.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `document_id` | uuid | structural, within this module |
| `version` | integer | 1, 2, 3 … per document |
| `storage_key` | text | opaque key from StorageService |
| `filename` / `mime_type` / `size_bytes` | | as uploaded |
| `checksum` | text | sha256, so a re-upload of identical bytes is detectable |
| `uploaded_by` / `created_at` | | |

**On versioning by default.** The master document asks for "one current version and a visible
history". Overwriting is how the wrong contract gets sent to a client with no way to prove what
changed. Storage is cheap; a superseded version costs nothing to keep.

### 3.3 Document chunk (the knowledge layer)

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `version_id` | uuid | chunks belong to a *version*, not a document — re-uploading re-indexes |
| `ordinal` | integer | position in the document |
| `content` | text | the chunk's text |
| `embedding` | vector(768) | pgvector; dimension set by the embedding model |

**Permission scope lives on the chunk's source.** A chunk is only ever returned after checking
the actor may see its document, per AI plan §3.3 — *"results are filtered by the querying
user's access before reaching the model"*. Retrieval that filters after the model has seen the
text is not filtering.

---

## 4. Search: three paths, deliberately ordered

Per AI plan §3.3, structured lookups stay the default. This phase adds the other two.

1. **Structured** (exists) — "which documents for DocHorse?" is a query, not a search.
2. **Full-text** (new) — Postgres `tsvector` over extracted text. Fast, exact, no model call,
   and correct for "find the document containing 'indexation clause'".
3. **Semantic** (new) — pgvector similarity for "what did we agree about reporting scope?",
   where the words in the question are not the words in the document.

Full-text is listed before semantic on purpose: it is cheaper, more predictable, and better at
the many searches that are really keyword lookups. Semantic search earns its cost on questions
of meaning.

**Text extraction:** plain text and markdown directly; PDF via a library; everything else is
stored but not indexed, and says so rather than silently returning nothing.

---

## 5. Manifest

- **Entities:** `document` (`/docs/documents/:id`)
- **Structural refs:** `document → client` (optional), `document → project` (optional), at least one enforced in the service
- **Publishes:** `document.uploaded`, `document.version_added`, `document.archived`
- **Subscribes:** none yet — Phase 5 will subscribe to file generated quotes/invoices here
- **Permissions:** `docs.read`, `docs.write`, `docs.delete`
- **Navigation:** Documents
- **Widgets:** `document-list` → CRM's client and project pages
- **Reporting views:** `docs.v_documents`
- **Portal exposure:** none in this phase — sharing is Phase 7, and nothing is portal-visible by default
- **AI tools:**

| Tool | Risk | Purpose |
|---|---|---|
| `docs_search` | `read` | full-text + semantic search across documents |
| `docs_list` | `read` | "which documents do we have for this client?" |
| `docs_ask` | `read` | answer from one document's content ("what is the notice period?") |

No write tools this phase. Uploading is a deliberate human act, and an assistant that files
documents on its own is exactly the autonomy the AI plan says to earn rather than assume.

---

## 6. Screens

1. **Documents** — list with search, filters by client/project/category.
2. **Document detail** — metadata, version history with download per version, upload-new-version,
   plus the core Links and Timeline panels.
3. **Client/project pages** — a documents widget contributed by this module, the same mechanism
   Time uses for budget burn.

---

## 7. Build order

| # | Step | Done when |
|---|---|---|
| 1 | `docs` schema; StorageService (local driver) | A file can be stored and read back by key |
| 2 | Document + version entities, upload, versioning | Re-uploading creates v2; v1 still downloadable |
| 3 | Screens: list, detail, upload | A real Finsera document is in the system |
| 4 | Text extraction + full-text search | Searching a phrase finds the document |
| 5 | Chunking + embeddings + semantic search | "What did we agree about X?" finds the right passage |
| 6 | AI tools bound; `docs_ask` | The assistant answers from a document, with the source named |
| 7 | S3 driver | Config-only switch, verified against any S3-compatible endpoint |

Step 7 is deliberately last and independent — it needs a Hetzner account, and nothing else in
the phase waits on it.

**Size:** L · ~5–7 weeks

---

## 8. Risks named up front

**Backups no longer cover everything.** Once files live outside Postgres, `pg_dump` is half the
backup. The storage directory must be included, and a restore drill must prove a document can
be *downloaded* after restore, not merely that its row exists.

**Embedding cost and drift.** Every version re-embeds. That is correct (chunks belong to a
version) but it costs tokens per upload, and changing embedding model later invalidates the
index — a full re-embed, not a migration. Worth choosing the model once, deliberately.

**Prompt injection gets real here.** Until now the assistant read data Finsera created. A client
PDF is untrusted input that will be fed to a model — AI plan §6 anticipates exactly this.
Retrieved content must be delimited as data, and no document content may ever escalate a tool's
risk class.
