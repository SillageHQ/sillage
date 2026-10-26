-- Changes introduced by feat(claude): unify local subscription pipeline.
-- The project historically used `prisma db push`; IF NOT EXISTS keeps this
-- first versioned migration safe for databases that received some changes
-- before migrations were introduced.

ALTER TABLE "Conversation"
  ADD COLUMN IF NOT EXISTS "claudeSessionId" text;

ALTER TABLE "Settings"
  ADD COLUMN IF NOT EXISTS "claudeModel" text NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS "claudeIngestionModel" text NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS "claudeEmbeddingModel" text NOT NULL DEFAULT 'multilingual-e5-small',
  ADD COLUMN IF NOT EXISTS "ingestionProvider" text NOT NULL DEFAULT 'openrouter';

CREATE TABLE IF NOT EXISTS "IngestionArtifact" (
  "id" text NOT NULL,
  "tenantId" text NOT NULL DEFAULT current_setting('app.tenant_id', true),
  "path" text NOT NULL,
  "contentHash" text NOT NULL,
  "pipelineSignature" text NOT NULL,
  "provider" text NOT NULL,
  "status" text NOT NULL DEFAULT 'received',
  "payload" jsonb NOT NULL,
  "error" jsonb,
  "appliedAt" timestamp(3),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "IngestionArtifact_pkey" PRIMARY KEY ("tenantId", "id"),
  CONSTRAINT "IngestionArtifact_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "IngestionArtifact_tenantId_path_contentHash_pipelineSignature_key"
  ON "IngestionArtifact" ("tenantId", "path", "contentHash", "pipelineSignature");
CREATE INDEX IF NOT EXISTS "IngestionArtifact_tenantId_status_idx"
  ON "IngestionArtifact" ("tenantId", "status");
CREATE INDEX IF NOT EXISTS "IngestionArtifact_tenantId_contentHash_idx"
  ON "IngestionArtifact" ("tenantId", "contentHash");

CREATE TABLE IF NOT EXISTS "LocalModelTask" (
  "id" text NOT NULL,
  "tenantId" text NOT NULL DEFAULT current_setting('app.tenant_id', true),
  "kind" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "result" jsonb,
  "error" text,
  "leaseId" text,
  "leaseExpiresAt" timestamp(3),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "LocalModelTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LocalModelTask_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "LocalModelTask_tenantId_id_key"
  ON "LocalModelTask" ("tenantId", "id");
CREATE INDEX IF NOT EXISTS "LocalModelTask_tenantId_status_createdAt_idx"
  ON "LocalModelTask" ("tenantId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "LocalModelTask_tenantId_leaseExpiresAt_idx"
  ON "LocalModelTask" ("tenantId", "leaseExpiresAt");
