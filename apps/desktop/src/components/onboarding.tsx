import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  Clock3,
  Coins,
  Cloud,
  Cpu,
  FileText,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  Moon,
  Pause,
  Palette,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Sun,
  WifiOff,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "@/lib/api";
import { applyAppearance, type AppTheme } from "@/lib/appearance";
import {
  estimateIndexing,
  type IndexEstimate,
  type ModelPricing,
  type VaultAnalysis,
} from "@/lib/index-estimate";
import { buildMemoryPresets, FINEST_INGESTION_MODEL_IDS } from "@/lib/memory-presets";
import { CLAUDE_MEMORY_PROFILES, findClaudeMemoryProfile } from "@/lib/claude-memory-profiles";

export type OnboardingSettings = {
  onboardingStep?: number;
  onboardingCompletedAt?: string | null;
  syncStatus?: string;
  vaultRootPath?: string;
  vaultPath?: string;
  hasOpenRouterApiKey?: boolean;
  theme?: AppTheme;
  accentColor?: string;
  defaultModel?: string;
  ingestionModel?: string;
  embeddingModel?: string;
  memoryPresetLevel?: number;
  ingestionProvider?: "openrouter" | "claude-code";
  claudeModel?: string;
  claudeIngestionModel?: string;
  claudeEmbeddingModel?: string;
};

type ClaudeAuthStatus = {
  installed: boolean;
  authenticated: boolean;
  subscriptionType?: string | null;
  version?: string | null;
  error?: string | null;
};

type ModelOption = {
  id: string;
  name: string;
  contextLength: number | null;
  intelligenceScore?: number | null;
  pricing?: ModelPricing;
};

const FALLBACK_MODELS: ModelOption[] = [
  { id: "openai/gpt-4.1-mini", name: "GPT-4.1 Mini", contextLength: 1_047_576 },
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", contextLength: 1_048_576 },
  { id: "deepseek/deepseek-chat-v3-0324", name: "DeepSeek V3", contextLength: 163_840 },
  { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", contextLength: 200_000 },
];

const ACCENTS = ["#6F8CFF", "#9B7BFF", "#E36E9C", "#E58B45", "#4BAE83", "#31A8C4"];
const CLAUDE_MODELS = [
  { id: "default", name: "Claude Code default" },
  { id: "sonnet", name: "Claude Sonnet" },
  { id: "opus", name: "Claude Opus" },
  { id: "fable", name: "Claude Fable" },
];
const STEPS = [
  { label: "Vault", icon: FolderOpen },
  { label: "AI", icon: KeyRound },
  { label: "Theme", icon: Moon },
  { label: "Accent", icon: Palette },
  { label: "Memory", icon: BrainCircuit },
  { label: "Index", icon: Sparkles },
];

function compactPath(value: string) {
  const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : value;
}

function responseError(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") return payload.error;
  return fallback;
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatCost(value: number) {
  if (value === 0) return "$0.00";
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

function formatTokens(value: number) {
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : `${Math.round(value / 1_000)}K`;
}

export function Onboarding({ initial, accessToken, onComplete }: { initial: OnboardingSettings; accessToken: string; onComplete: () => void }) {
  const initialIndexationStarted = initial.onboardingStep === 5 && [
    "indexing",
    "paused_openrouter_credits",
    "paused_claude_unavailable",
    "paused_connection_unavailable",
    "manifest_unavailable",
    "partial",
    "synced",
  ].includes(initial.syncStatus || "");
  const [step, setStep] = useState(initial.onboardingCompletedAt ? 5 : Math.max(0, Math.min(initial.onboardingStep ?? 0, 5)));
  const [vaultPath, setVaultPath] = useState(initial.vaultRootPath || initial.vaultPath || "");
  const [apiKey, setApiKey] = useState("");
  const [keyValid, setKeyValid] = useState(Boolean(initial.hasOpenRouterApiKey));
  const [keyLabel, setKeyLabel] = useState(initial.hasOpenRouterApiKey ? "Saved key" : "");
  const [ingestionProvider, setIngestionProvider] = useState<"openrouter" | "claude-code">(
    initial.ingestionProvider === "claude-code" ? "claude-code" : "openrouter",
  );
  const [claudeStatus, setClaudeStatus] = useState<ClaudeAuthStatus | null>(null);
  const [claudeBusy, setClaudeBusy] = useState(false);
  const [claudeModel, setClaudeModel] = useState(initial.claudeModel || "default");
  const [claudeIngestionModel, setClaudeIngestionModel] = useState(initial.claudeIngestionModel || "default");
  const [claudeEmbeddingModel, setClaudeEmbeddingModel] = useState(initial.claudeEmbeddingModel || "multilingual-e5-small");
  const claudeProfileIndex = findClaudeMemoryProfile(claudeIngestionModel, claudeEmbeddingModel);
  const displayedClaudeProfileIndex = claudeProfileIndex >= 0 ? claudeProfileIndex : 1;
  const selectedClaudeProfile = claudeProfileIndex >= 0 ? CLAUDE_MEMORY_PROFILES[claudeProfileIndex] : null;
  const [theme, setTheme] = useState<AppTheme>(initial.theme === "light" ? "light" : "dark");
  const [accent, setAccent] = useState(initial.accentColor || "#6F8CFF");
  const [models, setModels] = useState<ModelOption[]>(FALLBACK_MODELS);
  const [embeddingModels, setEmbeddingModels] = useState<ModelOption[]>([]);
  const [ingestionModel, setIngestionModel] = useState(initial.ingestionModel || "");
  const [embeddingModel, setEmbeddingModel] = useState(initial.embeddingModel || "openai/text-embedding-3-small");
  const [memoryLevel, setMemoryLevel] = useState(Math.max(0, Math.min(initial.memoryPresetLevel ?? 2, 4)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [watcherStatus, setWatcherStatus] = useState("Preparing your vault…");
  const [vaultAnalysis, setVaultAnalysis] = useState<VaultAnalysis | null>(null);
  const [indexEstimate, setIndexEstimate] = useState<IndexEstimate | null>(null);
  const [indexPhase, setIndexPhase] = useState<"estimate" | "indexing">(initial.onboardingCompletedAt || initialIndexationStarted ? "indexing" : "estimate");
  const [completionSaved, setCompletionSaved] = useState(Boolean(initial.onboardingCompletedAt));
  const [completionSaving, setCompletionSaving] = useState(false);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const draftQueueRef = useRef<Promise<void>>(Promise.resolve());
  const automaticEstimateRef = useRef(false);
  const completionSavingRef = useRef(false);

  useEffect(() => {
    if (ingestionProvider === "claude-code") void refreshClaudeStatus();
    if (initialIndexationStarted) {
      void observeIndexation();
    } else if (!initial.onboardingCompletedAt && step === 5 && !automaticEstimateRef.current) {
      automaticEstimateRef.current = true;
      void prepareEstimate();
    } else if (initial.hasOpenRouterApiKey) {
      void loadCatalog().catch(() => undefined);
    }
    return () => unlistenRef.current?.();
  }, []);

  const memoryPresets = useMemo(
    () => buildMemoryPresets(models, embeddingModels),
    [models, embeddingModels],
  );
  const selectedPreset = memoryPresets[memoryLevel];
  const selectedIngestionModel = models.find((model) => model.id === ingestionModel)
    ?? selectedPreset?.ingestionModel;
  const finestIngestionModels = useMemo(
    () => FINEST_INGESTION_MODEL_IDS
      .map((id) => models.find((model) => model.id === id))
      .filter((model): model is ModelOption => Boolean(model)),
    [models],
  );
  const isFinestLevel = memoryPresets.length > 0 && memoryLevel === memoryPresets.length - 1;

  function persistDraft(patch: Record<string, unknown>) {
    const operation = draftQueueRef.current.catch(() => undefined).then(async () => {
      const response = await fetch(`${API_URL}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(responseError(payload, "Unable to save your onboarding progress."));
    });
    draftQueueRef.current = operation;
    return operation;
  }

  function saveInBackground(patch: Record<string, unknown>) {
    void persistDraft(patch).catch((reason) => {
      setError(reason instanceof Error ? reason.message : "Unable to save your onboarding progress.");
    });
  }

  function chooseTheme(value: AppTheme) {
    setTheme(value);
    applyAppearance(value, accent);
    saveInBackground({ theme: value });
  }

  function chooseAccent(value: string) {
    const nextAccent = value.toUpperCase();
    setAccent(nextAccent);
    applyAppearance(theme, value);
    saveInBackground({ accentColor: nextAccent });
  }

  function chooseIngestionProvider(value: "openrouter" | "claude-code") {
    setIngestionProvider(value);
    saveInBackground({ ingestionProvider: value });
    if (value === "claude-code") void refreshClaudeStatus();
  }

  async function refreshClaudeStatus() {
    setClaudeBusy(true);
    setError("");
    try {
      setClaudeStatus(await invoke<ClaudeAuthStatus>("get_claude_auth_status"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to check Claude Code.");
    } finally {
      setClaudeBusy(false);
    }
  }

  async function connectClaude() {
    setClaudeBusy(true);
    setError("");
    try {
      const status = await invoke<ClaudeAuthStatus>("connect_claude");
      setClaudeStatus(status);
      if (!status.authenticated) throw new Error(status.error || "Claude Code login did not complete.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to connect Claude Code.");
    } finally {
      setClaudeBusy(false);
    }
  }

  async function chooseVault() {
    setError("");
    const selected = await open({ directory: true, multiple: false, title: "Choose your Obsidian vault" });
    if (typeof selected === "string") {
      setVaultPath(selected);
      saveInBackground({
        vaultPath: selected,
        vaultRootPath: selected,
        vaultSourceType: "manual",
        vaultSourceLabel: "Local Obsidian vault",
      });
    }
  }

  async function validateKey(candidate: string) {
    if (!candidate.trim()) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/v1/openrouter/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: candidate.trim() }),
      });
      const payload = await response.json() as {
        error?: string;
        key?: { label?: string };
        models?: ModelOption[];
        embeddingModels?: ModelOption[];
        defaults?: { embeddingModel?: string; rerankModel?: string };
      };
      if (!response.ok) throw new Error(responseError(payload, "This key could not be verified."));
      const nextModels = payload.models?.length ? payload.models : FALLBACK_MODELS;
      const nextEmbeddingModels = payload.embeddingModels ?? [];
      setModels(nextModels);
      setEmbeddingModels(nextEmbeddingModels);
      const presets = buildMemoryPresets(nextModels, nextEmbeddingModels);
      const level = presets.length
        ? Math.min(memoryLevel, presets.length - 1)
        : 0;
      const preset = presets[level];
      const nextIngestionModel = preset?.ingestionModel.id || ingestionModel;
      const nextEmbeddingModel = preset?.embeddingModel.id || payload.defaults?.embeddingModel || embeddingModel;
      setMemoryLevel(level);
      setIngestionModel(nextIngestionModel);
      setEmbeddingModel(nextEmbeddingModel);
      await persistDraft({
        openRouterApiKey: candidate.trim(),
        ingestionModel: nextIngestionModel,
        embeddingModel: nextEmbeddingModel,
        memoryPresetLevel: level,
        rerankModel: payload.defaults?.rerankModel,
      });
      setKeyLabel(payload.key?.label || "OpenRouter key verified");
      setKeyValid(true);
    } catch (reason) {
      setKeyValid(false);
      setError(reason instanceof Error ? reason.message : "This key could not be verified.");
    } finally {
      setBusy(false);
    }
  }

  async function loadCatalog() {
    const response = await fetch(`${API_URL}/v1/openrouter/catalog`);
    const payload = await response.json() as {
      error?: string;
      models?: ModelOption[];
      embeddingModels?: ModelOption[];
      defaults?: { embeddingModel?: string };
    };
    if (!response.ok) throw new Error(responseError(payload, "Unable to load OpenRouter pricing."));
    if (payload.models?.length) setModels(payload.models);
    if (payload.embeddingModels?.length) setEmbeddingModels(payload.embeddingModels);
    const nextModels = payload.models?.length ? payload.models : models;
    const nextEmbeddingModels = payload.embeddingModels?.length ? payload.embeddingModels : embeddingModels;
    const presets = buildMemoryPresets(nextModels, nextEmbeddingModels);
    if (presets.length) {
      const level = Math.min(memoryLevel, presets.length - 1);
      const preset = presets[level];
      const keepCustomFinestModel = level === presets.length - 1
        && FINEST_INGESTION_MODEL_IDS.some((id) => id === ingestionModel)
        && nextModels.some((model) => model.id === ingestionModel);
      setMemoryLevel(level);
      setIngestionModel(keepCustomFinestModel ? ingestionModel : preset.ingestionModel.id);
      setEmbeddingModel(preset.embeddingModel.id);
    } else if (payload.defaults?.embeddingModel && !initial.embeddingModel) {
      setEmbeddingModel(payload.defaults.embeddingModel);
    }
    return payload;
  }

  async function connectOpenRouter() {
    setBusy(true);
    setError("");
    try {
      const key = await invoke<string>("connect_openrouter");
      setApiKey(key);
      await validateKey(key);
    } catch (reason) {
      setKeyValid(false);
      setError(reason instanceof Error ? reason.message : "Unable to connect OpenRouter.");
      setBusy(false);
    }
  }

  async function prepareEstimate() {
    setBusy(true);
    setError("");
    try {
      await draftQueueRef.current.catch(() => undefined);
      if (ingestionProvider === "claude-code") {
        const analysis = await invoke<VaultAnalysis>("analyze_vault", { vaultPath });
        const notes = Math.max(0, analysis.indexableNoteCount);
        setVaultAnalysis(analysis);
        setIndexEstimate({
          sourceTokens: Math.max(0, analysis.estimatedSourceTokens),
          llmInputTokens: 0,
          llmOutputTokens: 0,
          embeddingTokens: Math.max(0, analysis.estimatedSourceTokens),
          durationSeconds: {
            low: notes ? Math.max(20, notes * 8) : 0,
            high: notes ? Math.max(60, notes * 30) : 0,
          },
          costUsd: { low: 0, high: 0 },
          assumptions: [
            "Extraction runs through the Claude Code subscription already connected on this computer.",
            "Sillage does not read or store Claude Code's OAuth credential.",
            "Your selected search model builds the private index locally on this computer.",
            "Time depends on Claude subscription limits, note complexity, and this computer staying awake.",
          ],
        });
        setIndexPhase("estimate");
        setStep(5);
        await persistDraft({
          onboardingStep: 5,
          vaultPath,
          vaultRootPath: vaultPath,
          theme,
          accentColor: accent,
          ingestionProvider,
          claudeModel,
          claudeIngestionModel,
          claudeEmbeddingModel,
        });
        return;
      }
      const [analysis, catalog] = await Promise.all([
        invoke<VaultAnalysis>("analyze_vault", { vaultPath }),
        loadCatalog(),
      ]);
      const catalogModels = catalog.models?.length ? catalog.models : models;
      const catalogEmbeddingModels = catalog.embeddingModels?.length ? catalog.embeddingModels : embeddingModels;
      const presets = buildMemoryPresets(catalogModels, catalogEmbeddingModels);
      const level = Math.min(memoryLevel, Math.max(0, presets.length - 1));
      const preset = presets[level];
      const selectedExtractionId = level === presets.length - 1
        && !FINEST_INGESTION_MODEL_IDS.some((id) => id === ingestionModel)
        ? preset?.ingestionModel.id
        : ingestionModel;
      const extraction = catalogModels.find((item) => item.id === selectedExtractionId)
        ?? preset?.ingestionModel;
      const embed = catalogEmbeddingModels.find((item) => item.id === embeddingModel)
        ?? preset?.embeddingModel
        ?? catalogEmbeddingModels.find((item) => item.id === catalog.defaults?.embeddingModel);
      if (!extraction?.pricing || !embed?.pricing) {
        throw new Error("OpenRouter pricing is unavailable for the selected models. Retry in a moment.");
      }
      const resolvedEmbeddingModel = embed.id;
      const resolvedIngestionModel = extraction.id;
      setMemoryLevel(level);
      setIngestionModel(resolvedIngestionModel);
      setEmbeddingModel(resolvedEmbeddingModel);
      setVaultAnalysis(analysis);
      setIndexEstimate(estimateIndexing(analysis, extraction.pricing, embed.pricing));
      setIndexPhase("estimate");
      setStep(5);
      await persistDraft({
        onboardingStep: 5,
        vaultPath,
        vaultRootPath: vaultPath,
        theme,
        accentColor: accent,
        ingestionModel: resolvedIngestionModel,
        embeddingModel: resolvedEmbeddingModel,
        memoryPresetLevel: level,
        ingestionProvider,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to analyze your vault.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmIndexation() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vaultPath,
          vaultRootPath: vaultPath,
          vaultSourceType: "manual",
          vaultSourceLabel: "Local Obsidian vault",
          theme,
          accentColor: accent,
          ingestionModel,
          embeddingModel,
          memoryPresetLevel: memoryLevel,
          ingestionProvider,
          claudeModel,
          claudeIngestionModel,
          claudeEmbeddingModel,
          syncStatus: "indexing",
          ...(apiKey.trim() ? { openRouterApiKey: apiKey.trim() } : {}),
          onboardingStep: 5,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(responseError(payload, "Unable to save your setup."));
      setIndexPhase("indexing");
      await beginIndexation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to start indexation.");
    } finally {
      setBusy(false);
    }
  }

  async function beginIndexation() {
    setBusy(true);
    setError("");
    setWatcherStatus(initial.onboardingCompletedAt ? "Checking your vault…" : "Starting indexation…");
    setIndexPhase("indexing");
    try {
      await observeIndexation();
      await invoke("restart_watcher", { token: accessToken });
      const currentStatus = await invoke<string>("get_watcher_status").catch(() => "");
      if (currentStatus) setWatcherStatus(currentStatus);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to start indexation.");
    } finally {
      setBusy(false);
    }
  }

  async function observeIndexation() {
    unlistenRef.current?.();
    unlistenRef.current = await listen<string>("watcher-status", (event) => setWatcherStatus(event.payload));
    const currentStatus = await invoke<string>("get_watcher_status").catch(() => "");
    if (currentStatus) setWatcherStatus(currentStatus);
  }

  async function pauseIndexation() {
    setBusy(true);
    setError("");
    setWatcherStatus("⏸ Pausing after current notes…");
    try {
      await invoke("pause_watcher");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to pause indexation.");
    } finally {
      setBusy(false);
    }
  }

  async function continueFlow() {
    setError("");
    if (step === 0 && !vaultPath) return setError("Choose your Obsidian vault to continue.");
    if (step === 1 && ingestionProvider === "openrouter" && !keyValid) return setError("Connect OpenRouter to continue.");
    if (step === 1 && ingestionProvider === "claude-code" && !claudeStatus?.authenticated) {
      return setError("Connect your Claude Code subscription to continue.");
    }
    if (step === 4 && ingestionProvider === "claude-code" && !claudeStatus?.authenticated) {
      return setError("Reconnect your Claude Code subscription to continue.");
    }
    if (step === 4 && ingestionProvider === "claude-code" && claudeProfileIndex < 0) {
      return setError("Choose a Claude memory duo to continue.");
    }
    if (step === 4) return prepareEstimate();
    const nextStep = Math.min(step + 1, 5);
    setBusy(true);
    try {
      await persistDraft({
        onboardingStep: nextStep,
        ...(step === 0 ? { vaultPath, vaultRootPath: vaultPath } : {}),
        ...(step === 1 ? { ingestionProvider } : {}),
        ...(step === 2 ? { theme } : {}),
        ...(step === 3 ? { accentColor: accent } : {}),
      });
      setStep(nextStep);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save your onboarding progress.");
    } finally {
      setBusy(false);
    }
  }

  async function goBack() {
    const previousStep = Math.max(0, step - 1);
    setError("");
    setBusy(true);
    try {
      await persistDraft({ onboardingStep: previousStep });
      setStep(previousStep);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save your onboarding progress.");
    } finally {
      setBusy(false);
    }
  }

  function chooseMemoryLevel(value: number) {
    const preset = memoryPresets[value];
    if (!preset) return;
    setMemoryLevel(value);
    setIngestionModel(preset.ingestionModel.id);
    setEmbeddingModel(preset.embeddingModel.id);
    saveInBackground({
      ingestionModel: preset.ingestionModel.id,
      embeddingModel: preset.embeddingModel.id,
      memoryPresetLevel: value,
    });
  }

  function chooseClaudeMemoryProfile(value: number) {
    const profile = CLAUDE_MEMORY_PROFILES[value];
    if (!profile) return;
    setClaudeIngestionModel(profile.ingestionModel);
    setClaudeEmbeddingModel(profile.embeddingModel);
    saveInBackground({
      claudeIngestionModel: profile.ingestionModel,
      claudeEmbeddingModel: profile.embeddingModel,
    });
  }

  function chooseFinestIngestionModel(value: string) {
    if (!isFinestLevel || !models.some((model) => model.id === value)) return;
    setIngestionModel(value);
    saveInBackground({ ingestionModel: value, memoryPresetLevel: memoryLevel });
  }

  const indexingDone = watcherStatus.startsWith("✓");
  const indexingPaused = watcherStatus.startsWith("⏸");
  const indexingPausedForCredits = indexingPaused && watcherStatus.includes("OpenRouter");
  const indexingPausedForClaude = indexingPaused && watcherStatus.includes("Claude Code");
  const indexingPausedManually = indexingPaused && (
    watcherStatus.includes("Resume") || watcherStatus.includes("Pausing")
  );
  const indexingFailed = watcherStatus.startsWith("⚠");

  async function finalizeOnboarding() {
    if (completionSaved || completionSavingRef.current) return;
    completionSavingRef.current = true;
    setCompletionSaving(true);
    setError("");
    try {
      await persistDraft({ onboardingComplete: true });
      setCompletionSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to finish your onboarding.");
    } finally {
      completionSavingRef.current = false;
      setCompletionSaving(false);
    }
  }

  useEffect(() => {
    if (!indexingDone || completionSaved || completionSavingRef.current) return;
    void finalizeOnboarding();
  }, [completionSaved, indexingDone]);

  return (
    <main className="flex min-h-screen bg-background text-foreground">
      <aside className="relative hidden w-[270px] shrink-0 flex-col border-r border-border/70 bg-sidebar px-8 py-9 md:flex">
        <div className="mb-14 flex items-center gap-3">
          <img src="/sillage-mark.svg" alt="" className="h-8 w-8" />
          <span className="text-sm font-semibold tracking-tight">Sillage</span>
        </div>
        <p className="mb-6 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Set up your space</p>
        <ol className="space-y-1">
          {STEPS.map((item, index) => {
            const Icon = item.icon;
            const active = index === step;
            const done = index < step;
            return (
              <li key={item.label} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition ${active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground"}`}>
                <span className={`grid h-7 w-7 place-items-center rounded-lg border ${active ? "border-primary/40 bg-primary/10 text-primary" : done ? "border-primary/20 text-primary" : "border-border"}`}>
                  {done ? <Check size={14} /> : <Icon size={14} />}
                </span>
                <span className={active ? "font-medium" : ""}>{item.label}</span>
              </li>
            );
          })}
        </ol>
        <p className="mt-auto text-xs leading-5 text-muted-foreground/65">Your vault stays on this computer. Sillage only indexes the notes you choose.</p>
      </aside>

      <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="pointer-events-none absolute inset-0 opacity-70 [background:radial-gradient(circle_at_55%_20%,color-mix(in_srgb,var(--primary)_10%,transparent),transparent_37%)]" />
        <div className="relative mx-auto flex w-full max-w-[820px] flex-1 flex-col px-7 py-8 md:px-14 md:py-12">
          <div className="mb-10 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Step {step + 1} of {STEPS.length}</span>
            <div className="flex gap-1.5">{STEPS.map((item, index) => <span key={item.label} className={`h-1 w-7 rounded-full ${index <= step ? "bg-primary" : "bg-border"}`} />)}</div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className="my-auto">
              {step === 0 && (
                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Your knowledge, in place</p>
                  <h1 className="max-w-xl text-4xl font-semibold leading-[1.08] tracking-[-0.035em] md:text-5xl">Where is your Obsidian vault?</h1>
                  <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">Choose the folder Sillage should watch and index. Your Markdown files won’t be moved or rewritten.</p>
                  <button type="button" onClick={() => void chooseVault()} className="mt-9 flex w-full max-w-xl items-center gap-4 rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition hover:border-primary/50">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><FolderOpen size={22} /></span>
                    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{vaultPath ? "Vault selected" : "Choose a folder"}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{vaultPath ? compactPath(vaultPath) : "Select your .md notes folder"}</span></span>
                    {vaultPath && <Check size={18} className="text-primary" />}
                  </button>
                </div>
              )}

              {step === 1 && (
                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Your AI provider</p>
                  <h1 className="text-4xl font-semibold tracking-[-0.035em] md:text-5xl">Choose your AI runtime</h1>
                  <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">Use Sillage Cloud, or run every AI operation through the Claude Code subscription connected on this computer.</p>
                  <div className="mt-8 grid max-w-2xl gap-3 sm:grid-cols-2">
                    <button type="button" onClick={() => chooseIngestionProvider("openrouter")} className={`rounded-2xl border p-5 text-left transition ${ingestionProvider === "openrouter" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card hover:border-primary/40"}`}>
                      <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><Cloud size={19} /></span>
                      <span className="mt-4 block text-sm font-semibold">Sillage Cloud</span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">OpenRouter handles extraction and embeddings. Works while this computer is offline.</span>
                    </button>
                    <button type="button" onClick={() => chooseIngestionProvider("claude-code")} className={`rounded-2xl border p-5 text-left transition ${ingestionProvider === "claude-code" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card hover:border-primary/40"}`}>
                      <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><Bot size={19} /></span>
                      <span className="mt-4 flex items-center gap-2 text-sm font-semibold">Claude Code local <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-amber-600 dark:text-amber-400">Beta</span></span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">Uses the model available through your Claude subscription. No Anthropic API key.</span>
                    </button>
                  </div>

                  {ingestionProvider === "claude-code" && (
                    <div className="mt-4 max-w-2xl rounded-2xl border border-border bg-card p-5 shadow-sm">
                      <div className="flex items-center gap-4">
                        <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${claudeStatus?.authenticated ? "bg-emerald-500/10 text-emerald-500" : "bg-primary/10 text-primary"}`}>{claudeStatus?.authenticated ? <Check size={21} /> : <Bot size={21} />}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">{claudeStatus?.authenticated ? "Claude Code connected" : claudeStatus?.installed === false ? "Claude Code not installed" : "Connect Claude Code"}</p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">{claudeStatus?.authenticated ? `${claudeStatus.subscriptionType || "Subscription login"}${claudeStatus.version ? ` · ${claudeStatus.version}` : ""}` : claudeStatus?.error || "Sillage delegates login to the official Claude Code CLI."}</p>
                        </div>
                        <button type="button" disabled={claudeBusy} onClick={() => void refreshClaudeStatus()} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground disabled:opacity-50">Refresh</button>
                      </div>
                      {claudeStatus?.installed !== false && !claudeStatus?.authenticated && <button type="button" disabled={claudeBusy} onClick={() => void connectClaude()} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">{claudeBusy ? <LoaderCircle size={17} className="animate-spin" /> : <ShieldCheck size={17} />}{claudeBusy ? "Waiting for Claude Code…" : "Connect Claude subscription"}</button>}
                      <p className="mt-4 text-[11px] leading-5 text-muted-foreground">Sillage never reads or stores the OAuth credential. Conversations and note processing run through Claude Code.</p>
                    </div>
                  )}

                  {ingestionProvider === "openrouter" && <div className="mt-4 max-w-2xl rounded-2xl border border-border bg-card p-5 shadow-sm">
                    <div className="flex items-center gap-4">
                      <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${keyValid ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}>{keyValid ? <Check size={21} /> : <KeyRound size={21} />}</span>
                      <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{keyValid ? "OpenRouter connected" : "Connect OpenRouter"}</p><p className="mt-1 truncate text-xs text-muted-foreground">{keyValid ? keyLabel : "A secure browser window will open"}</p></div>
                    </div>
                    <button type="button" disabled={busy} onClick={() => void connectOpenRouter()} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? <LoaderCircle size={17} className="animate-spin" /> : <KeyRound size={17} />}{busy ? "Waiting for OpenRouter…" : keyValid ? "Reconnect OpenRouter" : "Continue with OpenRouter"}</button>
                    <div className="mt-4 flex items-center justify-between gap-4"><p className="text-[11px] leading-5 text-muted-foreground">The generated key is encrypted before storage and is never shown in Sillage.</p><button type="button" onClick={() => void openUrl("https://openrouter.ai/keys")} className="shrink-0 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">Manage keys ↗</button></div>
                  </div>}
                </div>
              )}

              {step === 2 && (
                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Appearance</p>
                  <h1 className="text-4xl font-semibold tracking-[-0.035em] md:text-5xl">Choose your theme</h1>
                  <p className="mt-5 text-base leading-7 text-muted-foreground">Pick the reading environment that feels most comfortable.</p>
                  <div className="mt-9 grid max-w-xl grid-cols-2 gap-4">
                    {(["dark", "light"] as const).map((value) => { const Icon = value === "dark" ? Moon : Sun; return <button type="button" key={value} onClick={() => chooseTheme(value)} className={`rounded-2xl border p-5 text-left transition ${theme === value ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card hover:border-primary/40"}`}><div className={`mb-5 h-28 rounded-xl border p-3 ${value === "dark" ? "border-white/10 bg-[#171719]" : "border-black/10 bg-[#f4f3f0]"}`}><div className={`mb-2 h-2 w-14 rounded ${value === "dark" ? "bg-white/25" : "bg-black/20"}`} /><div className={`h-14 rounded ${value === "dark" ? "bg-white/7" : "bg-white"}`} /></div><span className="flex items-center gap-2 text-sm font-semibold capitalize"><Icon size={16} /> {value}</span></button>; })}
                  </div>
                </div>
              )}

              {step === 3 && (
                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Make it yours</p>
                  <h1 className="text-4xl font-semibold tracking-[-0.035em] md:text-5xl">Pick an accent</h1>
                  <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">This color highlights actions, selections and the small details that guide you.</p>
                  <div className="mt-10 flex flex-wrap gap-4">{ACCENTS.map((color) => <button key={color} type="button" aria-label={`Use ${color}`} onClick={() => chooseAccent(color)} className={`relative grid h-14 w-14 place-items-center rounded-2xl border-2 transition hover:scale-105 ${accent === color ? "border-foreground" : "border-transparent"}`}><span className="h-10 w-10 rounded-xl shadow-inner" style={{ backgroundColor: color }} />{accent === color && <Check size={16} className="absolute text-white drop-shadow" />}</button>)}<label className="grid h-14 w-14 cursor-pointer place-items-center rounded-2xl border border-border bg-card text-xs font-semibold"><input type="color" value={accent} onChange={(event) => chooseAccent(event.target.value)} className="sr-only" />Custom</label></div>
                  <div className="mt-10 max-w-xl rounded-2xl border border-border bg-card p-5"><div className="flex items-center gap-4"><span className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Sparkles size={18} /></span><div><p className="text-sm font-semibold">Sillage accent</p><p className="text-xs text-muted-foreground">{accent.toUpperCase()}</p></div><button type="button" className="ml-auto rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground">Preview</button></div></div>
                </div>
              )}

              {step === 4 && (
                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-primary">{ingestionProvider === "claude-code" ? "Memory duo" : "Memory depth"}</p>
                  <h1 className="max-w-2xl text-4xl font-semibold tracking-[-0.035em] md:text-5xl">{ingestionProvider === "claude-code" ? "Choose how Sillage reads and remembers" : "How carefully should Sillage read?"}</h1>
                  <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">{ingestionProvider === "claude-code" ? "Claude understands each note. A small local search model reconnects related ideas — pick the pair that suits your computer." : "Move the slider. Sillage pairs the right extraction and semantic-search models for you — no AI expertise required."}</p>
                  {ingestionProvider === "claude-code" && (
                    <div className="relative mt-9 max-w-2xl overflow-hidden rounded-[28px] border border-primary/30 bg-card p-6 shadow-sm">
                      <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-primary/10 blur-3xl" />
                      <div className="relative flex items-start gap-4">
                        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Bot size={23} /></span>
                        <div>
                          <div className="flex flex-wrap items-center gap-2"><p className="text-xl font-semibold tracking-tight">Claude Code + local search</p><span className="rounded-full bg-emerald-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">On this computer</span></div>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">Your Claude subscription reads the notes; E5 builds the private search index locally on CPU.</p>
                        </div>
                      </div>
                      <div className="relative mt-6 border-t border-border/70 pt-5">
                        <div className="flex items-baseline justify-between gap-4"><div><p className="text-xl font-semibold tracking-tight">{selectedClaudeProfile?.label || "Choose your duo"}</p><p className="mt-1 text-sm text-muted-foreground">{selectedClaudeProfile?.description || "Move the slider to select both models."}</p></div>{claudeProfileIndex === 1 && <span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">Recommended</span>}</div>
                        <div className="relative mt-8 h-6 rounded-full focus-within:ring-2 focus-within:ring-primary/40 focus-within:ring-offset-4 focus-within:ring-offset-card">
                          <input type="range" min={0} max={CLAUDE_MEMORY_PROFILES.length - 1} step={1} value={displayedClaudeProfileIndex} onChange={(event) => chooseClaudeMemoryProfile(Number(event.target.value))} aria-label="Claude memory duo" className="absolute inset-0 z-30 h-full w-full cursor-pointer opacity-0" />
                          <div className="pointer-events-none absolute inset-x-3 inset-y-0" aria-hidden="true"><span className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-[linear-gradient(90deg,color-mix(in_srgb,var(--muted-foreground)_25%,transparent),var(--primary))]" />{CLAUDE_MEMORY_PROFILES.map((profile, index) => <span key={profile.label} className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-muted-foreground" style={{ left: `${index * 100 / (CLAUDE_MEMORY_PROFILES.length - 1)}%` }} />)}<span className={`absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-background shadow-md transition-[left] ${selectedClaudeProfile ? "bg-primary" : "bg-muted-foreground"}`} style={{ left: `${displayedClaudeProfileIndex * 100 / (CLAUDE_MEMORY_PROFILES.length - 1)}%` }} /></div>
                        </div>
                        <div className="relative mx-3 mt-4 h-4">{CLAUDE_MEMORY_PROFILES.map((profile, index) => <button key={profile.label} type="button" onClick={() => chooseClaudeMemoryProfile(index)} className={`absolute top-0 -translate-x-1/2 whitespace-nowrap text-center text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors ${index === claudeProfileIndex ? "text-primary" : "text-muted-foreground hover:text-foreground"}`} style={{ left: `${index * 100 / (CLAUDE_MEMORY_PROFILES.length - 1)}%` }}>{profile.label}</button>)}</div>
                        {selectedClaudeProfile && <div className="mt-5 grid gap-2 sm:grid-cols-2"><div className="rounded-xl bg-secondary/70 px-4 py-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Reads &amp; structures</p><p className="mt-1 text-sm font-medium">{selectedClaudeProfile.ingestionLabel}</p></div><div className="rounded-xl bg-secondary/70 px-4 py-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Finds related ideas</p><p className="mt-1 text-sm font-medium">{selectedClaudeProfile.embeddingLabel}</p></div></div>}
                        <div className="mt-4 rounded-xl bg-secondary/70 px-4 py-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Conversation model</p><select value={claudeModel} onChange={(event) => { setClaudeModel(event.target.value); saveInBackground({ claudeModel: event.target.value }); }} className="mt-1 w-full bg-transparent text-sm font-medium outline-none">{CLAUDE_MODELS.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></div>
                      </div>
                      <p className="relative mt-4 text-xs leading-5 text-muted-foreground">The search model downloads once and stays cached locally. Small is the best default; Base trades speed and memory for richer matches.</p>
                    </div>
                  )}
                  <div className={`relative mt-9 max-w-2xl overflow-hidden rounded-[28px] border border-border bg-card p-6 shadow-sm ${ingestionProvider === "claude-code" ? "hidden" : ""}`}>
                    <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-primary/10 blur-3xl" />
                    <div className="relative flex items-start gap-4">
                      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><BrainCircuit size={23} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-4">
                          <div><p className="text-xl font-semibold tracking-tight">{selectedPreset?.label || "Balanced"}</p><p className="mt-1 text-sm text-muted-foreground">{selectedPreset?.description || "Best default for most vaults"}</p></div>
                          {memoryLevel === 2 && <span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">Recommended</span>}
                        </div>
                        <div className={`relative mt-8 h-6 rounded-full focus-within:ring-2 focus-within:ring-primary/40 focus-within:ring-offset-4 focus-within:ring-offset-card ${memoryPresets.length ? "" : "opacity-40"}`}>
                          <input
                            type="range"
                            min={0}
                            max={Math.max(0, memoryPresets.length - 1)}
                            step={1}
                            value={Math.min(memoryLevel, Math.max(0, memoryPresets.length - 1))}
                            disabled={!memoryPresets.length}
                            onChange={(event) => chooseMemoryLevel(Number(event.target.value))}
                            aria-label="Memory extraction depth"
                            className="absolute inset-0 z-30 h-full w-full cursor-pointer opacity-0 disabled:cursor-wait"
                          />
                          <div className="pointer-events-none absolute inset-x-3 inset-y-0" aria-hidden="true">
                            <span className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-[linear-gradient(90deg,color-mix(in_srgb,var(--muted-foreground)_25%,transparent),var(--primary))]" />
                            {memoryPresets.map((preset, index) => (
                              <span
                                key={preset.label}
                                className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-muted-foreground"
                                style={{ left: `${index * 100 / Math.max(1, memoryPresets.length - 1)}%` }}
                              />
                            ))}
                            <span
                              className="absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-background bg-primary shadow-md transition-[left]"
                              style={{ left: `${memoryLevel * 100 / Math.max(1, memoryPresets.length - 1)}%` }}
                            />
                          </div>
                        </div>
                        <div className="relative mx-3 mt-4 h-4">
                          {memoryPresets.map((preset, index) => (
                            <button
                              key={preset.label}
                              type="button"
                              onClick={() => chooseMemoryLevel(index)}
                              aria-pressed={index === memoryLevel}
                              className={`absolute top-0 -translate-x-1/2 whitespace-nowrap text-center text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors ${index === memoryLevel ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                              style={{ left: `${index * 100 / Math.max(1, memoryPresets.length - 1)}%` }}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                        <div className="mt-3 flex justify-between text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground"><span>Faster · lower cost</span><span>Richer memory</span></div>
                      </div>
                    </div>
                    {selectedPreset && (
                      <div className="relative mt-6 grid gap-2 border-t border-border/70 pt-5 sm:grid-cols-2">
                        <div className="rounded-xl bg-secondary/70 px-4 py-3">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Understands your notes</p>
                          {isFinestLevel && finestIngestionModels.length ? (
                            <div className="relative mt-1">
                              <select
                                value={ingestionModel || selectedPreset.ingestionModel.id}
                                onChange={(event) => chooseFinestIngestionModel(event.target.value)}
                                aria-label="Choose the Finest note understanding model"
                                className="w-full cursor-pointer appearance-none truncate bg-transparent pr-7 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                              >
                                {finestIngestionModels.map((model) => (
                                  <option key={model.id} value={model.id}>{model.name}</option>
                                ))}
                              </select>
                              <ChevronDown size={15} className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            </div>
                          ) : (
                            <p className="mt-1 truncate text-sm font-medium">{selectedIngestionModel?.name}</p>
                          )}
                        </div>
                        <div className="rounded-xl bg-secondary/70 px-4 py-3">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Finds related ideas</p>
                          <p className="mt-1 truncate text-sm font-medium">{selectedPreset.embeddingModel.name}</p>
                        </div>
                      </div>
                    )}
                  </div>
                  <p className="mt-4 max-w-2xl text-xs leading-5 text-muted-foreground">{ingestionProvider === "claude-code" ? "Claude Code handles conversations and extraction. OpenRouter is not called in this mode." : "This choice controls memory construction and semantic search. Your conversation model is configured separately."}</p>
                </div>
              )}

              {step === 5 && (
                indexPhase === "estimate" ? (
                  <div>
                    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Before we begin</p>
                    <h1 className="text-4xl font-semibold tracking-[-0.035em] md:text-5xl">Review your indexation</h1>
                    <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">{ingestionProvider === "claude-code" ? "Sillage analyzed your vault locally. Extraction will use your Claude Code subscription and local vectors, without Anthropic API billing." : "Sillage analyzed your vault locally. Review the approximate OpenRouter usage before any note is sent for indexation."}</p>
                    {vaultAnalysis && indexEstimate ? (
                      <>
                        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          <div className="rounded-2xl border border-border bg-card p-4"><FileText size={18} className="mb-4 text-primary" /><p className="text-2xl font-semibold tracking-tight">{vaultAnalysis.indexableNoteCount.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">notes to index</p></div>
                          <div className="rounded-2xl border border-border bg-card p-4"><Cpu size={18} className="mb-4 text-primary" /><p className="text-2xl font-semibold tracking-tight">≈ {formatTokens(indexEstimate.sourceTokens)}</p><p className="mt-1 text-xs text-muted-foreground">source tokens</p></div>
                          <div className="rounded-2xl border border-border bg-card p-4"><Clock3 size={18} className="mb-4 text-primary" /><p className="text-2xl font-semibold tracking-tight">{formatDuration(indexEstimate.durationSeconds.low)}–{formatDuration(indexEstimate.durationSeconds.high)}</p><p className="mt-1 text-xs text-muted-foreground">estimated time</p></div>
                          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4"><Coins size={18} className="mb-4 text-primary" /><p className="text-2xl font-semibold tracking-tight">{ingestionProvider === "claude-code" ? "Included" : `${formatCost(indexEstimate.costUsd.low)}–${formatCost(indexEstimate.costUsd.high)}`}</p><p className="mt-1 text-xs text-muted-foreground">{ingestionProvider === "claude-code" ? "Claude subscription" : "estimated cost"}</p></div>
                        </div>
                        <div className="mt-4 rounded-2xl border border-border bg-card px-5 py-4">
                          <div className="flex items-center justify-between gap-4"><p className="text-sm font-semibold">How this estimate works</p><p className="text-xs text-muted-foreground">{ingestionProvider === "claude-code" ? "Claude Code local" : selectedPreset?.label || "Memory preset"}</p></div>
                          <ul className="mt-3 grid gap-1.5 text-xs leading-5 text-muted-foreground sm:grid-cols-2">{indexEstimate.assumptions.map((assumption) => <li key={assumption} className="flex gap-2"><span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary" />{assumption}</li>)}</ul>
                          {vaultAnalysis.unreadableNotes > 0 && <p className="mt-3 text-xs text-amber-500">{vaultAnalysis.unreadableNotes} unreadable note(s) are excluded from this estimate.</p>}
                        </div>
                        <div className="mt-7 flex items-center justify-between border-t border-border/70 pt-6">
                          <button type="button" disabled={busy} onClick={() => void goBack()} className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><ArrowLeft size={16} /> Back</button>
                          <button type="button" disabled={busy} onClick={() => void confirmIndexation()} className="flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-sm disabled:opacity-50">{busy ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />}{busy ? "Starting…" : "Start indexation"}</button>
                        </div>
                      </>
                    ) : (
                      <div className="mt-10">
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">{busy && <LoaderCircle size={18} className="animate-spin text-primary" />}{busy ? "Analyzing notes and loading current OpenRouter prices…" : "The estimate could not be prepared."}</div>
                        {!busy && <div className="mt-6 flex gap-3"><button type="button" onClick={() => void goBack()} className="flex items-center gap-2 rounded-xl border border-border px-4 py-3 text-sm font-medium"><ArrowLeft size={16} /> Back</button><button type="button" onClick={() => void prepareEstimate()} className="rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground">Retry analysis</button></div>}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center">
                    <span className={`mx-auto grid h-20 w-20 place-items-center rounded-3xl ${indexingDone ? "bg-primary text-primary-foreground" : indexingPaused || indexingFailed ? "bg-amber-500/10 text-amber-500" : "bg-primary/10 text-primary"}`}>{indexingDone ? <Check size={34} /> : indexingPausedForCredits ? <Coins size={32} /> : indexingPaused ? <WifiOff size={32} /> : indexingFailed ? <FolderOpen size={32} /> : <LoaderCircle size={34} className="animate-spin" />}</span>
                    <h1 className="mt-7 text-4xl font-semibold tracking-[-0.035em]">{indexingDone ? "Your vault is ready" : indexingPaused ? "Indexation paused" : indexingFailed ? "Indexation needs attention" : "Building your memory"}</h1>
                    <p className="mx-auto mt-4 max-w-lg text-base leading-7 text-muted-foreground">{indexingDone ? "Your vault is indexed. Synchronization stays under your control and can be paused from Sillage." : indexingPausedForCredits ? "OpenRouter needs credits before Sillage can continue. Your remaining notes will be rescanned when you retry." : indexingPausedForClaude ? "Claude Code is unavailable, signed out, or has reached a subscription limit. Fix it locally, then retry without losing progress." : indexingPausedManually ? "Indexation is paused. Notes already in flight can finish safely; the remaining vault will be rescanned when you resume." : indexingPaused ? "Sillage could not reach the indexing service. Check the API and tunnel, then retry; your notes remain untouched." : indexingFailed ? watcherStatus : "Sillage is reading your notes and creating a private, searchable memory. You can pause whenever you want."}</p>
                    <div className="mx-auto mt-8 max-w-lg rounded-2xl border border-border bg-card px-5 py-4 text-left"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Live status</p><p className="mt-2 font-mono text-sm text-foreground">{watcherStatus}</p></div>
                    {indexingDone && <div className="mt-8 flex justify-center gap-3"><button type="button" disabled={busy} onClick={() => void pauseIndexation()} className="flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-3.5 text-sm font-semibold disabled:opacity-50"><Pause size={16} /> Pause sync</button><button type="button" disabled={completionSaving} onClick={completionSaved ? onComplete : () => void finalizeOnboarding()} className="flex items-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground disabled:cursor-wait disabled:opacity-60">{completionSaved ? <>Enter Sillage <ArrowRight size={16} /></> : completionSaving ? <><LoaderCircle size={16} className="animate-spin" /> Finishing…</> : <><RotateCcw size={16} /> Retry finish</>}</button></div>}
                    {indexingPaused && <div className="mt-8 flex justify-center gap-3">{indexingPausedForCredits && <button type="button" onClick={() => void openUrl("https://openrouter.ai/credits")} className="rounded-xl border border-border bg-card px-5 py-3.5 text-sm font-semibold">Add credits ↗</button>}<button type="button" disabled={busy} onClick={() => void beginIndexation()} className="flex items-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? <LoaderCircle size={16} className="animate-spin" /> : indexingPausedManually ? <Play size={16} /> : <RotateCcw size={16} />}{busy ? "Restarting…" : indexingPausedManually ? "Resume indexation" : "Retry indexation"}</button></div>}
                    {indexingFailed && <button type="button" disabled={busy} onClick={() => void beginIndexation()} className="mx-auto mt-8 flex items-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? <LoaderCircle size={16} className="animate-spin" /> : <RotateCcw size={16} />}{busy ? "Restarting…" : "Retry indexation"}</button>}
                    {!indexingDone && !indexingPaused && !indexingFailed && <button type="button" disabled={busy} onClick={() => void pauseIndexation()} className="mx-auto mt-8 flex items-center gap-2 rounded-xl border border-border bg-card px-6 py-3.5 text-sm font-semibold disabled:opacity-50">{busy ? <LoaderCircle size={16} className="animate-spin" /> : <Pause size={16} />}{busy ? "Pausing…" : "Pause indexation"}</button>}
                  </div>
                )
              )}
            </motion.div>
          </AnimatePresence>

          {error && <p className="relative mt-6 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-500" aria-live="polite">{error}</p>}
          {step < 5 && <footer className="relative mt-10 flex items-center justify-between border-t border-border/70 pt-6"><button type="button" disabled={step === 0 || busy} onClick={() => void goBack()} className="flex items-center gap-2 text-sm font-medium text-muted-foreground disabled:invisible"><ArrowLeft size={16} /> Back</button><button type="button" disabled={busy || (step === 4 && ingestionProvider === "claude-code" && (!claudeStatus?.authenticated || claudeProfileIndex < 0))} onClick={() => void continueFlow()} className="flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-sm disabled:opacity-50">{busy ? <LoaderCircle size={16} className="animate-spin" /> : step === 4 ? "Review estimate" : "Continue"}{!busy && <ArrowRight size={16} />}</button></footer>}
        </div>
      </section>
    </main>
  );
}
