CREATE TABLE IF NOT EXISTS "User" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  "emailVerified" boolean NOT NULL DEFAULT false,
  image text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Workspace" (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Membership" (
  "userId" text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "workspaceId" text NOT NULL REFERENCES "Workspace"(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner',
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "workspaceId")
);

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "displayName" text;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerified" boolean NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS image text;
-- Existing accounts predate the private-beta gate and must retain access.
-- Prisma changes the default to false during the schema push for future users.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
UPDATE "User" SET name = COALESCE(name, "displayName", split_part(email, '@', 1)) WHERE name IS NULL;
ALTER TABLE "User" ALTER COLUMN name SET NOT NULL;

INSERT INTO "User" (id, name, email, "emailVerified", "createdAt", "updatedAt")
SELECT '00000000-0000-0000-0000-000000000001', 'Legacy local user', 'legacy-local@sillage.invalid', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "User" WHERE id = '00000000-0000-0000-0000-000000000001');

ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_clerkId_key";

DO $settings_sequence$
BEGIN
  IF to_regclass('"Settings_id_seq"') IS NOT NULL THEN
    PERFORM setval(
      '"Settings_id_seq"',
      COALESCE((SELECT MAX(id) FROM "Settings"), 0) + 1,
      false
    );
  END IF;
END
$settings_sequence$;

INSERT INTO "Workspace" (id, name, slug, "createdAt", "updatedAt")
VALUES ('00000000-0000-0000-0000-000000000001', 'Legacy local workspace', 'legacy-local', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO "Membership" ("userId", "workspaceId", role)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'owner')
ON CONFLICT DO NOTHING;

DO $tenant_columns$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'Folder', 'Conversation', 'ConsolidationRun', 'VaultActionRun',
    'KnowledgeProposal', 'Message', 'VaultDraft', 'VaultDocument',
    'VaultChunk', 'NoteChange', 'Settings', 'CaptureJob', 'NoteIngestionJob'
  ] LOOP
    IF to_regclass(format('%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS "tenantId" text', table_name);
      EXECUTE format(
        'UPDATE %I SET "tenantId" = %L WHERE "tenantId" IS NULL',
        table_name,
        '00000000-0000-0000-0000-000000000001'
      );
      EXECUTE format('ALTER TABLE %I ALTER COLUMN "tenantId" SET NOT NULL', table_name);
      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN "tenantId" SET DEFAULT current_setting(''app.tenant_id'', true)',
        table_name
      );
    END IF;
  END LOOP;
END
$tenant_columns$;

-- Prisma replaces the temporary composite unique constraint with the final
-- composite primary key. Drop the dependent FK first so db push can perform
-- that transition safely; Prisma recreates it in the same schema push.
ALTER TABLE IF EXISTS "VaultChunk"
  DROP CONSTRAINT IF EXISTS "VaultChunk_tenantId_documentId_fkey";
