import { describe, expect, it } from "vitest";
import { buildMemoryPresets, closestMemoryPreset, FINEST_INGESTION_MODEL_IDS } from "./memory-presets";

const pricing = (prompt: number) => ({ prompt, completion: prompt * 2, request: 0 });
const ingestionModels = Array.from({ length: 10 }, (_, index) => ({
  id: `provider/model-${index}`,
  name: `Model ${index}`,
  intelligenceScore: (index + 1) * 10,
  pricing: pricing(index % 2 ? 0.000001 : 0.000002),
}));
const embeddingModels = [
  { id: "openai/text-embedding-3-small", name: "Small", pricing: pricing(0.00000002) },
  { id: "openai/text-embedding-3-large", name: "Large", pricing: pricing(0.00000013) },
];

describe("memory presets", () => {
  it("builds five increasingly capable value tiers", () => {
    const presets = buildMemoryPresets(ingestionModels, embeddingModels);
    expect(presets).toHaveLength(5);
    expect(presets.map((preset) => preset.ingestionModel.intelligenceScore)).toEqual([50, 60, 70, 80, 100]);
    expect(presets.slice(0, 3).every((preset) => preset.embeddingModel.id.endsWith("small"))).toBe(true);
    expect(presets.slice(3).every((preset) => preset.embeddingModel.id.endsWith("large"))).toBe(true);
  });

  it("restores the persisted pair to the corresponding slider stop", () => {
    const presets = buildMemoryPresets(ingestionModels, embeddingModels);
    expect(closestMemoryPreset(
      presets,
      presets[3].ingestionModel.id,
      presets[3].embeddingModel.id,
    )).toBe(3);
  });

  it("uses Kimi K3 as the Finest default when available", () => {
    const kimi = {
      id: FINEST_INGESTION_MODEL_IDS[0],
      name: "Kimi K3",
      intelligenceScore: 90,
      pricing: pricing(0.000003),
    };
    const presets = buildMemoryPresets([...ingestionModels, kimi], embeddingModels);
    expect(presets.at(-1)?.ingestionModel.id).toBe(kimi.id);
  });
});
