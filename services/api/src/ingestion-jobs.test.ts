import assert from "node:assert/strict";
import test from "node:test";
import { noteIngestionRequestKey } from "./ingestion-jobs.js";

test("note ingestion request keys deduplicate identical note revisions", () => {
  const first = noteIngestionRequestKey("Ideas/One.md", "same content");
  const repeated = noteIngestionRequestKey("Ideas/One.md", "same content");

  assert.equal(first, repeated);
  assert.notEqual(first, noteIngestionRequestKey("Ideas/Two.md", "same content"));
  assert.notEqual(first, noteIngestionRequestKey("Ideas/One.md", "edited content"));
});
