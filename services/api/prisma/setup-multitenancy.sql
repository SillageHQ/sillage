CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT nullif(current_setting('app.tenant_id', true), '') $$;

DO $app_role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sillage_app') THEN
    CREATE ROLE sillage_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$app_role$;

GRANT USAGE ON SCHEMA public TO sillage_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sillage_app;

DO $tenant_rls$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'Folder', 'Conversation', 'ConsolidationRun', 'VaultActionRun',
    'KnowledgeProposal', 'Message', 'VaultDraft', 'VaultDocument',
    'VaultChunk', 'IngestionArtifact', 'NoteChange', 'Settings', 'CaptureJob', 'NoteIngestionJob',
    'LocalModelTask'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = app_tenant_id()) WITH CHECK ("tenantId" = app_tenant_id())',
      table_name
    );
  END LOOP;
END
$tenant_rls$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "Folder", "Conversation", "ConsolidationRun", "VaultActionRun",
  "KnowledgeProposal", "Message", "VaultDraft", "VaultDocument",
  "VaultChunk", "IngestionArtifact", "NoteChange", "Settings", "CaptureJob", "NoteIngestionJob",
  "LocalModelTask"
TO sillage_app;
