CREATE INDEX IF NOT EXISTS "VaultChunk_embedding_hnsw_idx"
ON "VaultChunk" USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "VaultChunk_text_fts_idx"
ON "VaultChunk" USING gin (to_tsvector('simple', text));
