-- Conteo de filas de cada tabla del esquema public, en una línea `tabla=n,tabla=n` (ADR 0010).
-- Solo conteos: nunca datos. Lo usan backup.sh (manifiesto) y restore-test.sh (verificación).
SELECT coalesce(string_agg(format('%s=%s', relname, n), ',' ORDER BY relname), '')
FROM (
  SELECT c.relname,
         (xpath('/row/n/text()',
                query_to_xml(format('SELECT count(*) AS n FROM %I.%I', ns.nspname, c.relname),
                             false, true, '')))[1]::text::bigint AS n
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public' AND c.relkind = 'r'
) t;
