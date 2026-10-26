import { describe, expect, it } from "vitest";
import { estimateIndexing, type VaultAnalysis } from "./index-estimate";

const analysis = (overrides: Partial<VaultAnalysis> = {}): VaultAnalysis => ({
  noteCount: 10,
  indexableNoteCount: 10,
  totalBytes: 40_000,
  totalCharacters: 40_000,
  estimatedSourceTokens: 10_000,
  unreadableNotes: 0,
  ...overrides,
});

describe("index estimate", () => {
  it("returns zero cost and duration for an empty vault", () => {
    const result = estimateIndexing(
      analysis({ noteCount: 0, indexableNoteCount: 0, estimatedSourceTokens: 0 }),
      { prompt: 1e-6, completion: 2e-6, request: 0 },
      { prompt: 2e-8, completion: 0, request: 0 },
    );
    expect(result.durationSeconds).toEqual({ low: 0, high: 0 });
    expect(result.costUsd).toEqual({ low: 0, high: 0 });
  });

  it("uses catalog prices and keeps a conservative range", () => {
    const result = estimateIndexing(
      analysis(),
      { prompt: 1e-6, completion: 2e-6, request: 0 },
      { prompt: 2e-8, completion: 0, request: 0 },
    );
    expect(result.llmInputTokens).toBe(57_000);
    expect(result.llmOutputTokens).toBe(16_000);
    expect(result.embeddingTokens).toBe(30_000);
    expect(result.costUsd.low).toBeCloseTo(0.0672, 4);
    expect(result.costUsd.high).toBeCloseTo(0.1344, 4);
    expect(result.durationSeconds).toEqual({ low: 22, high: 66 });
  });

  it("bases work on non-empty indexable notes", () => {
    const result = estimateIndexing(
      analysis({ noteCount: 20, indexableNoteCount: 2 }),
      { prompt: 0, completion: 0, request: 0.01 },
      { prompt: 0, completion: 0, request: 0.005 },
    );
    expect(result.costUsd.low).toBeCloseTo(0.105);
    expect(result.durationSeconds).toEqual({ low: 16, high: 48 });
  });
});
