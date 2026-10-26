export type ClaudeMemoryProfile = {
  label: string;
  description: string;
  ingestionModel: "fable" | "sonnet" | "opus";
  ingestionLabel: string;
  embeddingModel: "multilingual-e5-small" | "multilingual-e5-base";
  embeddingLabel: string;
};

export const CLAUDE_MEMORY_PROFILES: ClaudeMemoryProfile[] = [
  {
    label: "Quick",
    description: "Fast reading and a lightweight multilingual search index",
    ingestionModel: "fable",
    ingestionLabel: "Claude Fable",
    embeddingModel: "multilingual-e5-small",
    embeddingLabel: "E5 Small",
  },
  {
    label: "Balanced",
    description: "The best balance of understanding, speed and local resources",
    ingestionModel: "sonnet",
    ingestionLabel: "Claude Sonnet",
    embeddingModel: "multilingual-e5-small",
    embeddingLabel: "E5 Small",
  },
  {
    label: "Deep",
    description: "Deeper note analysis and richer matching for powerful computers",
    ingestionModel: "opus",
    ingestionLabel: "Claude Opus",
    embeddingModel: "multilingual-e5-base",
    embeddingLabel: "E5 Base",
  },
];

export function findClaudeMemoryProfile(
  ingestionModel?: string,
  embeddingModel?: string,
) {
  return CLAUDE_MEMORY_PROFILES.findIndex(
    (profile) => profile.ingestionModel === ingestionModel
      && profile.embeddingModel === embeddingModel,
  );
}

export function hasSelectedClaudeMemoryProfile(
  ingestionModel?: string,
  embeddingModel?: string,
) {
  return findClaudeMemoryProfile(ingestionModel, embeddingModel) >= 0;
}
