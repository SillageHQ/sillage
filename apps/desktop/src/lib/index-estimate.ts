export type VaultAnalysis = {
  noteCount: number;
  indexableNoteCount: number;
  totalBytes: number;
  totalCharacters: number;
  estimatedSourceTokens: number;
  unreadableNotes: number;
};

export type ModelPricing = {
  prompt: number;
  completion: number;
  request: number;
};

export type IndexEstimate = {
  sourceTokens: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  embeddingTokens: number;
  durationSeconds: { low: number; high: number };
  costUsd: { low: number; high: number };
  assumptions: string[];
};

const WORKERS = 5;

export function estimateIndexing(
  analysis: VaultAnalysis,
  ingestionPricing: ModelPricing,
  embeddingPricing: ModelPricing,
): IndexEstimate {
  const notes = Math.max(0, analysis.indexableNoteCount);
  const sourceTokens = Math.max(0, analysis.estimatedSourceTokens);
  const llmInputTokens = Math.ceil(sourceTokens * 4.5 + notes * 1_200);
  const llmOutputTokens = Math.ceil(sourceTokens * 1.1 + notes * 500);
  const embeddingTokens = Math.ceil(sourceTokens * 3);
  const ingestionRequests = notes * 6;
  const embeddingRequests = notes * 2;
  const baseCost =
    llmInputTokens * ingestionPricing.prompt
    + llmOutputTokens * ingestionPricing.completion
    + ingestionRequests * ingestionPricing.request
    + embeddingTokens * embeddingPricing.prompt
    + embeddingRequests * embeddingPricing.request;
  const batches = notes ? Math.ceil(notes / WORKERS) : 0;

  return {
    sourceTokens,
    llmInputTokens,
    llmOutputTokens,
    embeddingTokens,
    durationSeconds: {
      low: notes ? 10 + batches * 6 : 0,
      high: notes ? 30 + batches * 18 : 0,
    },
    costUsd: {
      low: baseCost * 0.75,
      high: baseCost * 1.5,
    },
    assumptions: [
      "Token count uses a local approximation of 4 characters per token.",
      "Graph extraction is estimated at 4.5× source input plus 1,200 tokens per note.",
      "Entity extraction and summaries are estimated at 1.1× source output plus 500 tokens per note.",
      "Embeddings include note chunks, entities, and extracted facts (about 3× source tokens).",
      "Duration assumes five parallel workers and normal OpenRouter provider latency.",
      "The range is an estimate, not a spending limit; retries and unusually complex notes can increase it.",
    ],
  };
}
