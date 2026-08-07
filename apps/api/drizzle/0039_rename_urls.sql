-- The URLs are named after the thing, not the module that stores it.
--
-- `/crm/clients/:id` told you which NestJS module owns the row. `/clients/:id` tells you what
-- you are looking at. Same for `/scrum/tasks/:id` → `/tasks/:id`, and for sales and billing,
-- which were two prefixes for one subject and are now `/money/*`.
--
-- `core.entities.url_path` is a denormalised string written once at registration, so a code
-- change moves nothing that already exists. The app serves permanent redirects for every old
-- prefix (apps/web/src/shell/moved.tsx) — this is so the stored rows stop depending on them.
--
-- Longest prefix first, and each UPDATE is guarded by its own LIKE so the shorter rules cannot
-- reach a row a longer one already rewrote.

UPDATE core.entities SET url_path = '/clients'  || substring(url_path FROM 13) WHERE url_path LIKE '/crm/clients%';
UPDATE core.entities SET url_path = '/projects' || substring(url_path FROM 14) WHERE url_path LIKE '/crm/projects%';
UPDATE core.entities SET url_path = '/tasks'    || substring(url_path FROM 13) WHERE url_path LIKE '/scrum/tasks%';
UPDATE core.entities SET url_path = '/board/sprints' || substring(url_path FROM 15) WHERE url_path LIKE '/scrum/sprints%';
UPDATE core.entities SET url_path = '/board'    || substring(url_path FROM 7)  WHERE url_path LIKE '/scrum%';
UPDATE core.entities SET url_path = '/money/contracts' || substring(url_path FROM 17) WHERE url_path LIKE '/sales/contracts%';
UPDATE core.entities SET url_path = '/money/quotes'    || substring(url_path FROM 14) WHERE url_path LIKE '/sales/quotes%';
UPDATE core.entities SET url_path = '/money/rate-cards'|| substring(url_path FROM 18) WHERE url_path LIKE '/sales/rate-cards%';
UPDATE core.entities SET url_path = '/money/invoices'  || substring(url_path FROM 18) WHERE url_path LIKE '/billing/invoices%';
UPDATE core.entities SET url_path = '/money/invoices'  || substring(url_path FROM 9)  WHERE url_path LIKE '/billing%';

-- Nothing may be left pointing at a prefix the app no longer serves as a page. The redirects
-- would catch a stray, but a stored URL that needs a redirect is a URL that will rot.
DO $$
DECLARE stale int;
BEGIN
  SELECT count(*) INTO stale FROM core.entities
   WHERE url_path LIKE '/crm/%' OR url_path LIKE '/scrum%'
      OR url_path LIKE '/sales%' OR url_path LIKE '/billing%';
  IF stale > 0 THEN
    RAISE EXCEPTION 'core.entities still has % rows on a retired URL prefix', stale;
  END IF;
END $$;
