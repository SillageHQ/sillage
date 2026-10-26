export const OPENROUTER_API = "https://openrouter.ai/api/v1";
export const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const DEFAULT_RERANK_MODEL = "cohere/rerank-v3.5";

export function canUseOpenRouter(provider: string | null | undefined) {
  return provider !== "claude-code";
}

const MODEL_ID = /^[a-zA-Z0-9._:-]+\/[a-zA-Z0-9._:-]+$/;

export type OpenRouterPricing = {
  prompt: number;
  completion: number;
  request: number;
};

export type OpenRouterModel = {
  id: string;
  name: string;
  contextLength: number | null;
  intelligenceScore: number | null;
  pricing: OpenRouterPricing;
};

export type OpenRouterCatalog = {
  models: OpenRouterModel[];
  embeddingModels: OpenRouterModel[];
  defaults: { embeddingModel: string; rerankModel: string };
};

export function modelForMemoryRequest(
  pathname: string,
  models: { defaultModel: string; ingestionModel: string },
) {
  return pathname === "/ingest/note" ? models.ingestionModel : models.defaultModel;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function openRouterBillingError(payload: unknown, status: number): Record<string, unknown> | null {
  const envelope = record(payload);
  const detail = record(envelope?.detail);
  const error = detail ?? envelope;
  if (error?.code === "provider_billing_required") return error;
  if (status !== 402) return null;
  return error ?? {
    code: "provider_billing_required",
    provider: "OpenRouter",
    title: "OpenRouter credits required",
  };
}

type OpenRouterRawModel = {
  id?: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string; request?: string };
  benchmarks?: { artificial_analysis?: { intelligence_index?: number } };
};

function pricing(model: OpenRouterRawModel): OpenRouterPricing {
  const parse = (value: string | undefined) => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  };
  return {
    prompt: parse(model.pricing?.prompt),
    completion: parse(model.pricing?.completion),
    request: parse(model.pricing?.request),
  };
}

export function normalizeOpenRouterModels(value: unknown): OpenRouterModel[] {
  if (!value || typeof value !== "object" || !("data" in value) || !Array.isArray(value.data)) return [];
  return value.data
    .filter((model): model is OpenRouterRawModel & { id: string } => (
      Boolean(model && typeof model === "object" && typeof model.id === "string" && MODEL_ID.test(model.id))
    ))
    .map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      contextLength: typeof model.context_length === "number" ? model.context_length : null,
      intelligenceScore: typeof model.benchmarks?.artificial_analysis?.intelligence_index === "number"
        ? model.benchmarks.artificial_analysis.intelligence_index
        : null,
      pricing: pricing(model),
    }));
}

export async function loadOpenRouterCatalog(apiKey: string): Promise<OpenRouterCatalog> {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const [modelsResponse, embeddingsResponse] = await Promise.all([
    fetch(`${OPENROUTER_API}/models?supported_parameters=structured_outputs&sort=intelligence-high-to-low`, { headers }),
    fetch(`${OPENROUTER_API}/embeddings/models`, { headers }),
  ]);
  if (!modelsResponse.ok || !embeddingsResponse.ok) {
    throw new Error("Unable to load OpenRouter models");
  }
  const [modelsBody, embeddingsBody] = await Promise.all([
    modelsResponse.json(),
    embeddingsResponse.json(),
  ]);
  return {
    models: normalizeOpenRouterModels(modelsBody),
    embeddingModels: normalizeOpenRouterModels(embeddingsBody),
    defaults: { embeddingModel: DEFAULT_EMBEDDING_MODEL, rerankModel: DEFAULT_RERANK_MODEL },
  };
}
