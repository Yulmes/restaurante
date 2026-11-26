-- Grupo de la aplicación (ADR 0003): los GRANT del volcado lo nombran, así que tiene que existir
-- antes de restaurar. Sin login: no da acceso a nadie por sí mismo.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'marea_app_rw') THEN
    CREATE ROLE marea_app_rw NOLOGIN;
  END IF;
END
$$;
