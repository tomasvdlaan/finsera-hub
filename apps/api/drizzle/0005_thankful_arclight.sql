-- pgvector must exist before any vector column is declared. The dev and production
-- images are pgvector/pgvector:pg16, where the extension ships but is not enabled.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE SCHEMA "docs";
--> statement-breakpoint
CREATE TABLE "docs"."chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(768),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docs"."documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"client_id" uuid,
	"project_id" uuid,
	"category" text,
	"current_version_id" uuid,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "documents_has_a_home" CHECK ("docs"."documents"."client_id" IS NOT NULL OR "docs"."documents"."project_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "docs"."versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum" text NOT NULL,
	"extracted_text" text,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "docs"."chunks" ADD CONSTRAINT "chunks_version_id_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "docs"."versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "docs"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."versions" ADD CONSTRAINT "versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "docs"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunks_version_idx" ON "docs"."chunks" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "chunks_document_idx" ON "docs"."chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "documents_client_idx" ON "docs"."documents" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "documents_project_idx" ON "docs"."documents" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "versions_document_version" ON "docs"."versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE INDEX "versions_document_idx" ON "docs"."versions" USING btree ("document_id");
--> statement-breakpoint
-- Approximate-nearest-neighbour index for semantic search. HNSW over cosine distance,
-- matching the `<=>` operator the queries use. Drizzle cannot express this, so it lives
-- here rather than being created ad hoc at runtime.
CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON docs.chunks USING hnsw (embedding vector_cosine_ops);
