import assert from "node:assert/strict";
import test from "node:test";
import { canUseOpenRouter, modelForMemoryRequest, normalizeOpenRouterModels, openRouterBillingError } from "./openrouter.js";

test("never permits OpenRouter credentials in Claude Code mode", () => {
  assert.equal(canUseOpenRouter("claude-code"), false);
  assert.equal(canUseOpenRouter("openrouter"), true);
  assert.equal(canUseOpenRouter(undefined), true);
});

test("normalizes OpenRouter per-token pricing without trusting malformed values", () => {
  const models = normalizeOpenRouterModels({
    data: [
      {
        id: "vendor/model",
        name: "Model",
        context_length: 128_000,
        benchmarks: { artificial_analysis: { intelligence_index: 42.5 } },
        pricing: { prompt: "0.000001", completion: "0.000002", request: "bad" },
      },
      { id: "invalid" },
    ],
  });

  assert.deepEqual(models, [{
    id: "vendor/model",
    name: "Model",
    contextLength: 128_000,
    intelligenceScore: 42.5,
    pricing: { prompt: 0.000001, completion: 0.000002, request: 0 },
  }]);
});

test("unwraps structured OpenRouter billing errors from the memory service", () => {
  assert.deepEqual(
    openRouterBillingError({ detail: { code: "provider_billing_required", provider: "OpenRouter" } }, 500),
    { code: "provider_billing_required", provider: "OpenRouter" },
  );
  assert.equal(openRouterBillingError(null, 402)?.code, "provider_billing_required");
  assert.equal(openRouterBillingError({ error: "temporary failure" }, 500), null);
});

test("uses the ingestion model only while building note memory", () => {
  const models = { defaultModel: "vendor/conversation", ingestionModel: "vendor/extraction" };
  assert.equal(modelForMemoryRequest("/ingest/note", models), "vendor/extraction");
  assert.equal(modelForMemoryRequest("/ask/stream", models), "vendor/conversation");
});
