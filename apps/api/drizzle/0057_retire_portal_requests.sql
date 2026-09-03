-- The requests become tickets, and then the old table goes.
--
-- `portal.requests` was terminal by design: open, then converted or declined, with nowhere
-- for an answer to live. So the answer went back to email, and the system held one half of
-- a conversation while the client held the other. Tickets are the same idea with a thread.
--
-- The rows are moved rather than left behind. A table nothing reads is the second source of
-- truth this codebase keeps arguing against — and these rows are a client's own words about
-- their own work, which is exactly the history a thread should start with rather than lose.
--
-- The mapping:
--   * every request becomes one ticket, keeping its id, so anything that recorded a request
--     id in the audit log still points at the same thing;
--   * its body becomes the first message, authored by the client who wrote it;
--   * 'open' becomes 'waiting_on_finsera', which is what it always meant;
--   * 'converted' and 'declined' both become 'closed' — the difference between them is
--     whether `task_id` is set, which is more informative than the two words were.
INSERT INTO "portal"."tickets"
  (id, client_id, portal_user_id, subject, status, project_id, task_id,
   last_client_message_at, closed_at, closed_by, created_at)
SELECT r.id, r.client_id, r.portal_user_id, r.subject,
       CASE WHEN r.status = 'open' THEN 'waiting_on_finsera' ELSE 'closed' END,
       r.project_id, r.task_id,
       r.created_at,
       CASE WHEN r.status = 'open' THEN NULL ELSE COALESCE(r.handled_at, r.created_at) END,
       CASE WHEN r.status = 'open' THEN NULL ELSE r.handled_by END,
       r.created_at
  FROM "portal"."requests" r;
--> statement-breakpoint
-- One message per request, and a deterministic id derived from the request's own — so
-- running this twice would collide on the primary key rather than silently duplicating a
-- client's words, which is the failure worth having.
INSERT INTO "portal"."ticket_messages" (id, ticket_id, author_kind, author_id, body, internal_only, created_at)
SELECT r.id, r.id, 'client', r.portal_user_id, r.body, false, r.created_at
  FROM "portal"."requests" r;
--> statement-breakpoint
DROP TABLE "portal"."requests" CASCADE;
