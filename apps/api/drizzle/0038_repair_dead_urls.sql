-- Point twenty live records at a page that exists.
--
-- `core.entities.url_path` is denormalised per row, and the timeline, the link picker, search
-- and every assistant citation navigate straight to that stored string. Three entity types
-- were registered with an address no page has ever served: a contact at `/crm/contacts/:id`,
-- an hour at `/time/entries/:id`, and a portal user at a route that existed in the bundle and
-- was never wired up. Nineteen time entries and one contact were affected, each of them
-- findable, mentionable, and dead on arrival.
--
-- The services now write the right path. This repairs the rows already written, which is the
-- half a code change cannot reach.

-- A contact is read on its client's page.
UPDATE core.entities e
   SET url_path = '/crm/clients/' || c.client_id
  FROM crm.contacts c
 WHERE c.id = e.id
   AND e.entity_type = 'contact';

-- An hour is read in its day.
UPDATE core.entities e
   SET url_path = '/time?date=' || t.worked_on
  FROM time.entries t
 WHERE t.id = e.id
   AND e.entity_type = 'time_entry';

-- Anything left pointing at the two dead prefixes had no row behind it to repair from —
-- send it somewhere real rather than leaving a link that cannot resolve.
UPDATE core.entities SET url_path = '/crm/clients'
 WHERE entity_type = 'contact' AND url_path LIKE '/crm/contacts/%';
UPDATE core.entities SET url_path = '/time'
 WHERE entity_type = 'time_entry' AND url_path LIKE '/time/entries/%';
