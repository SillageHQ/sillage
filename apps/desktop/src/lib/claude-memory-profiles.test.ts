import { describe, expect, it } from "vitest";
import {
  CLAUDE_MEMORY_PROFILES,
  findClaudeMemoryProfile,
  hasSelectedClaudeMemoryProfile,
} from "./claude-memory-profiles";

describe("Claude memory profiles", () => {
  it("maps every slider position to a unique model pair", () => {
    expect(new Set(CLAUDE_MEMORY_PROFILES.map(
      (profile) => `${profile.ingestionModel}:${profile.embeddingModel}`,
    )).size).toBe(CLAUDE_MEMORY_PROFILES.length);
  });

  it("does not treat the implicit Claude default as an explicit selection", () => {
    expect(findClaudeMemoryProfile("default", "multilingual-e5-small")).toBe(-1);
    expect(hasSelectedClaudeMemoryProfile("default", "multilingual-e5-small")).toBe(false);
  });

  it("recognizes a slider-selected pair", () => {
    const balanced = CLAUDE_MEMORY_PROFILES[1];
    expect(findClaudeMemoryProfile(balanced.ingestionModel, balanced.embeddingModel)).toBe(1);
    expect(hasSelectedClaudeMemoryProfile(balanced.ingestionModel, balanced.embeddingModel)).toBe(true);
  });
});
