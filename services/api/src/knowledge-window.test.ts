import assert from "node:assert/strict";
import test from "node:test";
import {
  proposalSyncComplete,
  selectConsolidationWindow,
  selectRegenerationContext,
  shouldReuseConsolidation,
} from "./knowledge-window.js";

test("an empty consolidation draft is regenerated instead of being reused forever", () => {
  assert.equal(shouldReuseConsolidation({ status: "draft", proposals: [] }), false);
  assert.equal(shouldReuseConsolidation({ status: "failed", proposals: [] }), false);
  assert.equal(shouldReuseConsolidation({ status: "generating", proposals: [] }), true);
  assert.equal(shouldReuseConsolidation({ status: "draft", proposals: [{}] }), true);
});

test("regeneration reuses the latest user message and excludes the replaced pair from history", () => {
  const messages = [
    { id: "older-user", role: "user", text: "Earlier question" },
    { id: "older-answer", role: "brain", text: "Earlier answer" },
    { id: "current-user", role: "user", text: "Current question" },
    { id: "current-answer", role: "brain", text: "Current answer" },
  ];

  const context = selectRegenerationContext(messages, "current-answer");

  assert.equal(context?.userMessage.id, "current-user");
  assert.equal(context?.assistantMessage.id, "current-answer");
  assert.deepEqual(context?.history.map((message) => message.id), ["older-user", "older-answer"]);
});

test("regeneration refuses an older or non-assistant message", () => {
  const messages = [
    { id: "user", role: "user", text: "Question" },
    { id: "answer", role: "brain", text: "Answer" },
    { id: "new-user", role: "user", text: "New question" },
  ];

  assert.equal(selectRegenerationContext(messages, "answer"), null);
  assert.equal(selectRegenerationContext(messages, "new-user"), null);
});

test("consolidation resumes strictly after the resolved cursor", () => {
  const messages = [
    { id: "one", text: "already consolidated" },
    { id: "two", text: "new decision" },
    { id: "three", text: "new correction" },
  ];
  assert.deepEqual(selectConsolidationWindow(messages, "one").map((message) => message.id), ["two", "three"]);
});

test("retry-sync only resolves after target and removed sources match the watcher index", () => {
  assert.equal(proposalSyncComplete("update", "new-hash", "new-hash", 0), true);
  assert.equal(proposalSyncComplete("update", "old-hash", "new-hash", 0), false);
  assert.equal(proposalSyncComplete("move", "new-hash", "new-hash", 1), false);
  assert.equal(proposalSyncComplete("delete", null, "empty-hash", 0), true);
});

test("a bounded window never advances through an unanalysed message", () => {
  const messages = [
    { id: "one", text: "12345" },
    { id: "two", text: "67890" },
    { id: "three", text: "later" },
  ];
  assert.deepEqual(selectConsolidationWindow(messages, null, 100, 9).map((message) => message.id), ["one"]);
});
