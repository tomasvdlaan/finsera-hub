-- Stamp a flow role onto every board column that predates the field.
--
-- `flowOf` in the schema defaults a missing role on read, and `v_column_flow` repeats that
-- default in SQL — but a default is a guess, and for one column it guesses wrong. "Waiting on
-- client" is not a done column and not the first column, so the fallback calls it active, and
-- cycle time then counts every day a client sat on something as time we were working. That is
-- precisely the flattery the column was created to prevent.
--
-- Matching on the key here is a one-time backfill of rows that already exist, not runtime
-- logic: every board in the database today carries exactly the five default columns. Anything
-- unrecognised falls through to the same guess the code makes, so a hand-made column is no
-- worse off than before.
UPDATE scrum.boards b
   SET columns = sub.columns,
       updated_at = now()
  FROM (
    SELECT b2.project_id,
           jsonb_agg(
             c.value || jsonb_build_object('flow',
               CASE WHEN (c.value->>'isDone')::boolean         THEN 'done'
                    WHEN c.value->>'key' = 'waiting_on_client' THEN 'waiting'
                    WHEN c.ord = 1                             THEN 'queue'
                    ELSE 'active' END)
             ORDER BY c.ord
           ) AS columns
      FROM scrum.boards b2,
           LATERAL jsonb_array_elements(b2.columns) WITH ORDINALITY AS c(value, ord)
     GROUP BY b2.project_id
  ) sub
 WHERE b.project_id = sub.project_id;
