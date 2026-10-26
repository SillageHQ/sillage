import type { ModelPricing } from "./index-estimate";

export type MemoryModel = {
  id: string;
  name: string;
  intelligenceScore?: number | null;
  pricing?: ModelPricing;
};

export type MemoryPreset = {
  label: string;
  description: string;
  ingestionModel: MemoryModel;
  embeddingModel: MemoryModel;
};

export const FINEST_INGESTION_MODEL_IDS = [
  "moonshotai/kimi-k3",
  "minimax/minimax-m3",
  "z-ai/glm-5.2",
  "x-ai/grok-4.5",
] as const;

const LEVELS = [
  { label: "Light", description: "Fastest and lowest cost" },
  { label: "Focused", description: "A little more context" },
  { label: "Balanced", description: "Best default for most vaults" },
  { label: "Deep", description: "Finer links and entities" },
  { label: "Finest", description: "Maximum extraction quality" },
];

function extractionCost(model: MemoryModel) {
  if (!model.pricing) return Number.POSITIVE_INFINITY;
  return model.pricing.prompt * 4.5 + model.pricing.completion * 1.1 + model.pricing.request * 6;
}

function ingestionCandidates(models: MemoryModel[]) {
  const rated = models
    .filter((model) => Number.isFinite(model.intelligenceScore) && model.pricing)
    .sort((left, right) => (left.intelligenceScore ?? 0) - (right.intelligenceScore ?? 0));
  if (!rated.length) return models.filter((model) => model.pricing);
  const qualityFloor = (rated.at(-1)?.intelligenceScore ?? 0) * 0.45;
  return rated.filter((model) => (model.intelligenceScore ?? 0) >= qualityFloor);
}

export function buildMemoryPresets(
  models: MemoryModel[],
  embeddingModels: MemoryModel[],
): MemoryPreset[] {
  const candidates = ingestionCandidates(models);
  if (!candidates.length || !embeddingModels.length) return [];
  const smallEmbedding = embeddingModels.find((model) => model.id === "openai/text-embedding-3-small")
    ?? [...embeddingModels].sort((left, right) => extractionCost(left) - extractionCost(right))[0];
  const largeEmbedding = embeddingModels.find((model) => model.id === "openai/text-embedding-3-large")
    ?? smallEmbedding;

  return LEVELS.map((level, index) => {
    const start = Math.floor(index * candidates.length / LEVELS.length);
    const end = Math.max(start + 1, Math.floor((index + 1) * candidates.length / LEVELS.length));
    const bucket = candidates.slice(start, end);
    const ingestionModel = index === LEVELS.length - 1
      ? candidates.find((model) => model.id === FINEST_INGESTION_MODEL_IDS[0]) ?? candidates.at(-1)!
      : [...bucket].sort((left, right) => extractionCost(left) - extractionCost(right))[0];
    return {
      ...level,
      ingestionModel,
      embeddingModel: index >= 3 ? largeEmbedding : smallEmbedding,
    };
  });
}

export function closestMemoryPreset(
  presets: MemoryPreset[],
  ingestionModel: string,
  embeddingModel: string,
) {
  const exact = presets.findIndex((preset) => (
    preset.ingestionModel.id === ingestionModel && preset.embeddingModel.id === embeddingModel
  ));
  if (exact >= 0) return exact;
  const ingestionMatch = presets.findIndex((preset) => preset.ingestionModel.id === ingestionModel);
  return ingestionMatch >= 0 ? ingestionMatch : Math.floor(presets.length / 2);
}
