import path from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { serve } from "@hono/node-server";
import { Prisma } from "@prisma/client";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { stream } from "hono/streaming";
import { request as undiciRequest } from "undici";
import { provisionAccount } from "./accounts.js";
import { registerAppReleaseRoutes } from "./app-releases.js";
import { auth } from "./auth.js";
import { activateBetaAccess, betaAccessEnabled, BetaCodeError, releaseWaitlistBetaCode, reserveWaitlistBetaCode } from "./beta-access.js";
import { systemPrisma } from "./database.js";
import { sendBetaAccessEmail } from "./email.js";
import {
  proposalSyncComplete,
  selectConsolidationWindow,
  selectRegenerationContext,
  shouldReuseConsolidation,
} from "./knowledge-window.js";
import { noteIngestionRequestKey } from "./ingestion-jobs.js";
import { currentClaudePipelineSignature, localEmbeddingModel, parseArtifactPreflight, parseIngestionArtifact, type IngestionArtifactV1 } from "./ingestion-artifacts.js";
import { cancelPaddleSubscription, createPaddleTransaction, handlePaddleWebhook, hasActivePaddleSubscription, paddleBillingIntervalFromPriceId, paddleClientConfigured, paddleConfigured, paddleNoteLimit, paddlePlanAvailability, paddlePlanFromPriceId, type PaddleBillingInterval, type PaddlePlanId, verifyPaddleWebhook } from "./paddle.js";
import {
  canUseOpenRouter,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_RERANK_MODEL,
  loadOpenRouterCatalog,
  modelForMemoryRequest,
  openRouterBillingError,
  OPENROUTER_API,
} from "./openrouter.js";
import { fuseRagCandidates, useRetrievalV2 } from "./rag-search.js";
import { createTenantPrisma, runAsTenant, tenantContext, type TenantContext, withTenantTransaction } from "./tenant-db.js";

try {
  process.loadEnvFile();
} catch {
  // .env optional (e.g. vars injected by the platform)
}

const MEMORY = process.env.MEMORY_URL ?? "http://localhost:8000";
const PORT = Number(process.env.PORT ?? 3001);
const NOTE_INGESTION_WORKERS = 5;

const prisma = createTenantPrisma(systemPrisma);
const app = new Hono();
const allowedOrigins = new Set((process.env.CORS_ALLOWED_ORIGINS ?? "http://localhost:5173,http://localhost:3000,http://localhost:1420,tauri://localhost,http://tauri.localhost,https://tauri.localhost")
  .split(",").map((origin) => origin.trim()).filter(Boolean));
app.use("*", cors({
  origin: (origin) => allowedOrigins.has(origin) ? origin : "",
  allowHeaders: [
    "Authorization",
    "Content-Type",
    "skip_zrok_interstitial",
  ],
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  exposeHeaders: ["set-auth-token"],
  credentials: true,
}));

const CAPTURE_TERMINAL_STATUSES = new Set(["done", "failed"]);
const LOCAL_MODEL_TASK_KINDS = new Set(["chat", "embedding", "rerank", "ingestion"]);
const LOCAL_MODEL_TASK_LEASE_MS = 12 * 60 * 1000;

function settingsEncryptionKey() {
  const secret = process.env.SETTINGS_ENCRYPTION_KEY ?? process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("SETTINGS_ENCRYPTION_KEY or BETTER_AUTH_SECRET must be configured");
  return createHash("sha256").update(secret).digest();
}

function encryptSetting(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", settingsEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decryptSetting(value: string) {
  const [version, ivRaw, tagRaw, encryptedRaw] = value.split(":");
  if (version !== "v1" || !ivRaw || !tagRaw || !encryptedRaw) throw new Error("Unsupported encrypted setting");
  const decipher = createDecipheriv("aes-256-gcm", settingsEncryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, "base64url")), decipher.final()]).toString("utf8");
}

async function memoryHeaders(pathname: string, initHeaders?: RequestInit["headers"]) {
  const { tenantId } = tenantContext();
  const headers = new Headers(initHeaders);
  headers.set("X-Sillage-Tenant", tenantId);
  const internalToken = process.env.MEMORY_INTERNAL_TOKEN;
  if (!internalToken) throw new Error("MEMORY_INTERNAL_TOKEN is not configured");
  headers.set("Authorization", `Bearer ${internalToken}`);
  const llmSettings = await prisma.settings.findUnique({
    where: { tenantId },
    select: {
      openRouterApiKeyEncrypted: true,
      defaultModel: true,
      claudeModel: true,
      claudeIngestionModel: true,
      claudeEmbeddingModel: true,
      ingestionModel: true,
      embeddingModel: true,
      ingestionProvider: true,
      rerankModel: true,
    },
  });
  if (canUseOpenRouter(llmSettings?.ingestionProvider) && llmSettings?.openRouterApiKeyEncrypted) {
    try {
      headers.set("X-Sillage-OpenRouter-Key", decryptSetting(llmSettings.openRouterApiKeyEncrypted));
      headers.set(
        "X-Sillage-Model",
        modelForMemoryRequest(pathname, llmSettings),
      );
      headers.set("X-Sillage-Embedding-Model", llmSettings.embeddingModel);
      headers.set("X-Sillage-Rerank-Model", llmSettings.rerankModel);
    } catch (error) {
      console.error("Unable to decrypt the tenant OpenRouter key", error);
    }
  }
  headers.set("X-Sillage-Ingestion-Provider", llmSettings?.ingestionProvider ?? "openrouter");
  if (llmSettings?.ingestionProvider === "claude-code") {
    headers.set("X-Sillage-Model", llmSettings.claudeModel);
    headers.set("X-Sillage-Ingestion-Model", llmSettings.claudeIngestionModel);
    headers.set("X-Sillage-Claude-Embedding-Model", llmSettings.claudeEmbeddingModel);
  }
  return headers;
}

async function memoryFetch(pathname: string, init: RequestInit = {}) {
  const headers = await memoryHeaders(pathname, init.headers);
  return fetch(`${MEMORY}${pathname}`, { ...init, headers });
}

async function runLongMemoryIngestion(note: Prisma.JsonValue) {
  const headers = await memoryHeaders("/ingest/note", { "Content-Type": "application/json" });
  const response = await undiciRequest(`${MEMORY}/ingest/note`, {
    method: "POST",
    headers: Object.fromEntries(headers.entries()),
    body: JSON.stringify(note),
    headersTimeout: 0,
    bodyTimeout: 0,
  });
  const raw = await response.body.text();
  let payload: unknown;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { error: raw || "memory service rejected note ingestion" };
  }
  return {
    ok: response.statusCode >= 200 && response.statusCode < 300,
    status: response.statusCode,
    payload,
  };
}

function secretsMatch(expected: string | undefined, provided: string | undefined) {
  if (!expected || !provided) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}

function productAccessEnabled(billingEnabled: boolean, betaAccess = false) {
  return betaAccess || billingEnabled || process.env.NODE_ENV !== "production" && process.env.REQUIRE_BILLING_ACCESS !== "true";
}

type ProviderErrorPayload = {
  code?: string;
  provider?: string;
  title?: string;
  message?: string;
  actionUrl?: string;
  retryable?: boolean;
};

type ConversationMode = "read" | "curator";
type NoteChangePayload = {
  kind: "created" | "modified" | "deleted";
  noteTitle: string;
  notePath: string;
  beforeContent?: string;
  afterContent?: string;
  addedLines?: number;
  removedLines?: number;
};

function conversationMode(value: unknown): ConversationMode {
  return value === "curator" ? "curator" : "read";
}

function requestsSavingLastAnswer(value: string): boolean {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\b(ne|n')\s*(pas|jamais)\s+(sauvegarde|ajoute|garde|enregistre)/.test(normalized)) return false;
  return /\b(sauvegarde|enregistre|garde|ajoute)\b.*\b(derniere|ta|cette)\s+(reponse|answer)\b/.test(normalized)
    || /\b(save|add)\b.*\b(last|this|your)\s+(answer|response)\b.*\b(vault|obsidian)\b/.test(normalized);
}

type CaptureSourceType = "web_page" | "youtube" | "audio_url" | "unknown_url";

type CaptureResult = {
  ok?: boolean;
  title?: string;
  path?: string;
  url?: string;
  source_type?: string;
  answer?: string;
  facts?: unknown;
  error?: string;
  detail?: unknown;
};

type FactSource = {
  fact: string;
  source_type: "note" | "chat";
  source_title: string | null;
  note_title: string | null;
  note_path: string | null;
  conversation_id: string | null;
};

type KnowledgeOrigin =
  | "user_authored"
  | "user_message"
  | "assistant_synthesis"
  | "external_source"
  | "conversation"
  | "model_knowledge";
type KnowledgeAuthority = "low" | "medium" | "high";
type KnowledgeSource = {
  origin: KnowledgeOrigin;
  authority: KnowledgeAuthority;
  userId?: string;
  groupId?: string;
  notePath?: string;
  chunkId?: string;
  conversationId?: string;
  messageId?: string;
  url?: string;
  title?: string;
  retrievedAt?: string;
  excerpt?: string;
};

type RagChunkInput = {
  id: string;
  headingPath: string;
  startLine: number;
  endLine: number;
  text: string;
  contentHash: string;
  embedding?: number[];
};

type RagSearchRow = {
  id: string;
  documentId: string;
  path: string;
  title: string;
  headingPath: string;
  startLine: number;
  endLine: number;
  text: string;
  score: number;
  semanticScore: number;
  lexicalScore: number;
};

type SaveDraftResponse = {
  title: string;
  target_folder: string;
  markdown: string;
  rationale: string;
};

function safeNoteFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "Saved insight";
}

function draftTargetPath(folder: string, title: string): string {
  const safeFolder = folder.split(/[\\/]+/).filter((part) => part && part !== "." && part !== "..").join("/");
  const file = `${safeNoteFileName(title)}.md`;
  return safeFolder ? path.posix.join(safeFolder, file) : file;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Base64URL(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function validLoopbackRedirect(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const redirect = new URL(value);
    if (
      redirect.protocol !== "http:"
      || redirect.hostname !== "127.0.0.1"
      || !redirect.port
      || redirect.pathname !== "/auth/callback"
      || redirect.username
      || redirect.password
      || redirect.search
      || redirect.hash
    ) return null;
    const port = Number(redirect.port);
    return Number.isInteger(port) && port > 0 && port <= 65_535 ? redirect.toString() : null;
  } catch {
    return null;
  }
}

const KNOWLEDGE_ORIGINS = new Set<KnowledgeOrigin>([
  "user_authored",
  "user_message",
  "assistant_synthesis",
  "external_source",
  "conversation",
  "model_knowledge",
]);
const KNOWLEDGE_AUTHORITIES = new Set<KnowledgeAuthority>(["low", "medium", "high"]);

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function vectorLiteral(value: unknown): string | null {
  if (!Array.isArray(value) || value.length !== 1024) return null;
  const numbers = value.map(Number);
  if (numbers.some((item) => !Number.isFinite(item))) return null;
  return `[${numbers.join(",")}]`;
}

function normalizeKnowledgeSources(value: unknown): KnowledgeSource[] {
  if (!Array.isArray(value)) return [];
  const context = tenantContext();
  const sources = new Map<string, KnowledgeSource>();
  for (const item of value) {
    const record = jsonRecord(item);
    if (!record || !KNOWLEDGE_ORIGINS.has(record.origin as KnowledgeOrigin)) continue;
    if (!KNOWLEDGE_AUTHORITIES.has(record.authority as KnowledgeAuthority)) continue;
    const source: KnowledgeSource = {
      origin: record.origin as KnowledgeOrigin,
      authority: record.authority as KnowledgeAuthority,
      userId: context.userId,
      groupId: context.tenantId,
      notePath: optionalString(record.notePath),
      chunkId: optionalString(record.chunkId),
      conversationId: optionalString(record.conversationId),
      messageId: optionalString(record.messageId),
      url: optionalString(record.url),
      title: optionalString(record.title),
      retrievedAt: optionalString(record.retrievedAt),
      excerpt: optionalString(record.excerpt),
    };
    const key = source.chunkId || source.notePath || source.messageId || source.url
      || `${source.origin}:${source.title || source.excerpt || "unknown"}`;
    if (!sources.has(key)) sources.set(key, source);
  }
  return [...sources.values()];
}

function knowledgeSourcesFromFacts(value: unknown): KnowledgeSource[] {
  if (!Array.isArray(value)) return [];
  const context = tenantContext();
  return normalizeKnowledgeSources(value.map((item) => {
    const fact = jsonRecord(item);
    if (!fact) return null;
    if (fact.source_type === "note") {
      return {
        origin: "user_authored",
        authority: "high",
        userId: context.userId,
        groupId: context.tenantId,
        chunkId: fact.chunk_id,
        notePath: fact.note_path,
        title: fact.note_title || fact.source_title,
        excerpt: fact.fact,
      };
    }
    if (fact.source_type === "chat") {
      return {
        origin: "conversation",
        authority: "low",
        userId: context.userId,
        groupId: context.tenantId,
        conversationId: fact.conversation_id,
        title: fact.source_title,
        excerpt: fact.fact,
      };
    }
    return null;
  }));
}

function messageProvenance(role: "user" | "brain", messageId: string): KnowledgeSource {
  const context = tenantContext();
  return {
    origin: role === "user" ? "user_message" : "assistant_synthesis",
    authority: role === "user" ? "medium" : "low",
    userId: context.userId,
    groupId: context.tenantId,
    messageId,
  };
}

async function resolveLegacyFactSources(values: Prisma.JsonValue[]): Promise<Map<string, FactSource>> {
  const facts = [...new Set(
    values.flatMap((value) => {
      const record = jsonRecord(value);
      return typeof record?.fact === "string" && !record.source_type ? [record.fact] : [];
    }),
  )];
  if (!facts.length) return new Map();

  try {
    const response = await memoryFetch("/facts/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facts }),
    });
    if (!response.ok) return new Map();
    const body = await response.json() as { sources?: FactSource[] };
    return new Map((body.sources ?? []).map((source) => [source.fact, source]));
  } catch {
    return new Map();
  }
}

function clampSummaryDegree(value: unknown): number {
  const degree = Number(value ?? 3);
  if (!Number.isFinite(degree)) return 3;
  return Math.max(1, Math.min(5, Math.round(degree)));
}

function normalizeDestinationFolder(value: unknown): string {
  const folder = typeof value === "string" ? value.trim() : "";
  return folder || "1. INBOX";
}

function providerErrorText(error: ProviderErrorPayload): string {
  const title = error.title || `${error.provider || "AI provider"} unavailable`;
  const message = error.message || "The AI provider rejected the request.";
  const action = error.actionUrl ? `\n\nOpen billing: ${error.actionUrl}` : "";
  return `${title}\n\n${message}${action}`;
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function detectCaptureSourceType(rawUrl: string): CaptureSourceType {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (
      host === "youtu.be" ||
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtube-nocookie.com" ||
      host.endsWith(".youtube-nocookie.com")
    ) {
      return "youtube";
    }
    if (/\.(mp3|m4a|wav|aac|flac|ogg|oga|opus|webm|mp4|m4v|mov)(?:$|[?#])/.test(path)) {
      return "audio_url";
    }
    if (url.protocol === "http:" || url.protocol === "https:") {
      return "web_page";
    }
  } catch {
    /* memory service will return the validation error */
  }
  return "unknown_url";
}

function captureFailedAnswer(error: string): string {
  return `Capture failed: ${error}`;
}

function captureStatusForSource(sourceType: string): string {
  if (sourceType === "audio_url") return "transcribing";
  return "extracting";
}

async function persistCaptureAssistantMessage(job: {
  conversationId: string | null;
  sourceUrl: string;
  sourceType: string;
  title: string | null;
  notePath: string | null;
  answer: string | null;
  facts: Prisma.JsonValue | null;
  error: string | null;
}) {
  if (!job.conversationId) return;
  const messageId = randomUUID();
  const sources = normalizeKnowledgeSources([
    messageProvenance("brain", messageId),
    ...knowledgeSourcesFromFacts(job.facts),
    ...(job.error ? [] : [{
      origin: "external_source",
      authority: "medium",
      url: job.sourceUrl,
      title: job.title || job.sourceType,
    }]),
  ]);
  await prisma.message.create({
    data: {
      id: messageId,
      conversationId: job.conversationId,
      role: "brain",
      text: job.answer || captureFailedAnswer(job.error || "unknown error"),
      facts: (Array.isArray(job.facts) ? job.facts : undefined) as Prisma.InputJsonValue | undefined,
      sources: sources as Prisma.InputJsonValue,
    },
  });
  await prisma.conversation.update({ where: { id: job.conversationId }, data: { updatedAt: new Date() } });
}

async function runCaptureJob(jobId: string) {
  const job = await prisma.captureJob.findUnique({ where: { id: jobId } });
  if (!job || CAPTURE_TERMINAL_STATUSES.has(job.status)) return job;

  await prisma.captureJob.update({
    where: { id: jobId },
    data: { status: captureStatusForSource(job.sourceType), error: null },
  });

  try {
    const upstream = await memoryFetch("/capture/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: job.sourceUrl,
        instruction: job.instruction,
        summary_degree: job.summaryDegree,
        destination_folder: job.destinationFolder,
      }),
    });
    const result = (await upstream.json().catch(() => ({}))) as CaptureResult;
    const ok = upstream.ok && result.ok !== false;
    if (!ok) {
      const rawError = result.detail || result.error || upstream.statusText || "capture failed";
      const error = typeof rawError === "string" ? rawError : JSON.stringify(rawError);
      const failed = await prisma.captureJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          error,
          answer: result.answer || captureFailedAnswer(error),
        },
      });
      await persistCaptureAssistantMessage(failed);
      return failed;
    }

    const done = await prisma.captureJob.update({
      where: { id: jobId },
      data: {
        status: "done",
        sourceType: result.source_type || job.sourceType,
        title: result.title || null,
        notePath: result.path || null,
        answer: result.answer || "Captured.",
        facts: (Array.isArray(result.facts) ? result.facts : undefined) as Prisma.InputJsonValue | undefined,
        error: null,
      },
    });
    await persistCaptureAssistantMessage(done);
    return done;
  } catch (err) {
    const error = err instanceof Error ? err.message : "memory service is unavailable";
    const failed = await prisma.captureJob.update({
      where: { id: jobId },
      data: { status: "failed", error, answer: captureFailedAnswer(error) },
    });
    await persistCaptureAssistantMessage(failed);
    return failed;
  }
}

async function createCaptureJob(input: {
  url: string;
  instruction?: string;
  summaryDegree?: number;
  destinationFolder?: string;
  conversationId?: string;
  message?: string;
}) {
  const sourceUrl = input.url.trim();
  const instruction = input.instruction?.trim() ?? "";
  const summaryDegree = clampSummaryDegree(input.summaryDegree);
  const destinationFolder = normalizeDestinationFolder(input.destinationFolder);
  const conversationId = input.conversationId?.trim() || null;
  const sourceType = detectCaptureSourceType(sourceUrl);

  if (conversationId && input.message?.trim()) {
    const messageId = randomUUID();
    await prisma.message.create({
      data: {
        id: messageId,
        conversationId,
        role: "user",
        text: input.message.trim(),
        sources: [messageProvenance("user", messageId)] as Prisma.InputJsonValue,
      },
    });
  }

  return prisma.captureJob.create({
    data: {
      sourceUrl,
      sourceType,
      instruction,
      summaryDegree,
      destinationFolder,
      conversationId,
    },
  });
}

function captureJobResponse(job: {
  id: string;
  status: string;
  sourceUrl: string;
  sourceType: string;
  instruction: string;
  summaryDegree: number;
  destinationFolder: string;
  title: string | null;
  notePath: string | null;
  answer: string | null;
  facts: Prisma.JsonValue | null;
  error: string | null;
  conversationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    jobId: job.id,
    id: job.id,
    status: job.status,
    sourceUrl: job.sourceUrl,
    sourceType: job.sourceType,
    instruction: job.instruction,
    summaryDegree: job.summaryDegree,
    destinationFolder: job.destinationFolder,
    title: job.title,
    notePath: job.notePath,
    path: job.notePath,
    answer: job.answer,
    facts: job.facts,
    sources: normalizeKnowledgeSources([
      ...knowledgeSourcesFromFacts(job.facts),
      ...(job.status === "done" ? [{
        origin: "external_source",
        authority: "medium",
        url: job.sourceUrl,
        title: job.title || job.sourceType,
      }] : []),
    ]),
    error: job.error,
    conversationId: job.conversationId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ok: job.status === "done" ? true : job.status === "failed" ? false : undefined,
  };
}

const noteIngestionQueue: Array<{ jobId: string; context: TenantContext }> = [];
const scheduledNoteIngestionJobs = new Set<string>();
let activeNoteIngestionJobs = 0;

function prismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function noteIngestionJobResponse(job: {
  id: string;
  status: string;
  result: Prisma.JsonValue | null;
  error: Prisma.JsonValue | null;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    jobId: job.id,
    status: job.status,
    result: job.result,
    error: job.error,
    attempts: job.attempts,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

async function runNoteIngestionJob(jobId: string) {
  const claimed = await prisma.noteIngestionJob.updateMany({
    where: { id: jobId, status: "queued" },
    data: {
      status: "processing",
      attempts: { increment: 1 },
      startedAt: new Date(),
      finishedAt: null,
      result: Prisma.DbNull,
      error: Prisma.DbNull,
    },
  });
  if (claimed.count !== 1) return;

  const job = await prisma.noteIngestionJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  try {
    const response = await runLongMemoryIngestion(job.note);
    const providerError = openRouterBillingError(response.payload, response.status);
    if (!response.ok || providerError) {
      const error = providerError ?? {
        code: "note_ingestion_failed",
        status: response.status,
        detail: response.payload,
      };
      await prisma.noteIngestionJob.update({
        where: { id: jobId },
        data: { status: "failed", error: prismaJson(error), finishedAt: new Date() },
      });
      return;
    }
    const resultPayload = response.payload as Record<string, unknown>;
    if (resultPayload?.artifact) {
      await persistArtifactChunks(parseIngestionArtifact(resultPayload.artifact));
      delete resultPayload.artifact;
    }
    await prisma.noteIngestionJob.update({
      where: { id: jobId },
      data: {
        status: "done",
        result: prismaJson(response.payload),
        error: Prisma.DbNull,
        finishedAt: new Date(),
      },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "memory service is unavailable";
    await prisma.noteIngestionJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        error: prismaJson({ code: "memory_unavailable", message }),
        finishedAt: new Date(),
      },
    });
  }
}

function pumpNoteIngestionQueue() {
  while (activeNoteIngestionJobs < NOTE_INGESTION_WORKERS && noteIngestionQueue.length > 0) {
    const item = noteIngestionQueue.shift();
    if (!item) return;
    activeNoteIngestionJobs += 1;
    void runAsTenant(item.context, () => runNoteIngestionJob(item.jobId))
      .catch((error) => console.error(`[ingest] job ${item.jobId} failed`, error))
      .finally(() => {
        activeNoteIngestionJobs -= 1;
        scheduledNoteIngestionJobs.delete(item.jobId);
        queueMicrotask(pumpNoteIngestionQueue);
      });
  }
}

function scheduleNoteIngestionJob(jobId: string, context: TenantContext) {
  if (scheduledNoteIngestionJobs.has(jobId)) return;
  scheduledNoteIngestionJobs.add(jobId);
  noteIngestionQueue.push({ jobId, context: { ...context } });
  queueMicrotask(pumpNoteIngestionQueue);
}

async function recoverNoteIngestionJobs() {
  await systemPrisma.noteIngestionJob.updateMany({
    where: { status: "processing" },
    data: { status: "queued", startedAt: null },
  });
  const jobs = await systemPrisma.noteIngestionJob.findMany({
    where: { status: "queued" },
    select: { id: true, tenantId: true },
    orderBy: { createdAt: "asc" },
  });
  const tenantIds = [...new Set(jobs.map((job) => job.tenantId))];
  const memberships = await systemPrisma.membership.findMany({
    where: { workspaceId: { in: tenantIds } },
    select: { workspaceId: true, userId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const ownerByTenant = new Map<string, string>();
  for (const membership of memberships) {
    if (!ownerByTenant.has(membership.workspaceId)) {
      ownerByTenant.set(membership.workspaceId, membership.userId);
    }
  }
  for (const job of jobs) {
    const userId = ownerByTenant.get(job.tenantId);
    if (!userId) continue;
    scheduleNoteIngestionJob(job.id, {
      tenantId: job.tenantId,
      userId,
      authUserId: userId,
    });
  }
}

app.get("/health", (c) => c.json({ ok: true }));
registerAppReleaseRoutes(app, systemPrisma);

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.post("/v1/beta/waitlist", async (c) => {
  const expectedToken = process.env.WAITLIST_INTERNAL_TOKEN?.trim();
  const providedToken = c.req.header("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if (!secretsMatch(expectedToken, providedToken)) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json<{ name?: unknown; email?: unknown }>().catch(() => ({} as { name?: unknown; email?: unknown }));
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (name.length < 2 || name.length > 120 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: "invalid waitlist details" }, 400);
  }

  const reservation = await reserveWaitlistBetaCode(systemPrisma, email);
  if (!reservation) return c.json({ betaAssigned: false });
  try {
    await sendBetaAccessEmail(email, reservation.code, name.split(" ")[0] || name);
    return c.json({ betaAssigned: true, position: reservation.position });
  } catch (error) {
    await releaseWaitlistBetaCode(systemPrisma, email).catch((releaseError) => {
      console.error("Failed to release beta waitlist reservation", releaseError instanceof Error ? releaseError.message : "unknown error");
    });
    console.error("Beta access email failed", error instanceof Error ? error.message : "unknown error");
    return c.json({ error: "beta email unavailable" }, 502);
  }
});

app.post("/v1/billing/webhook", async (c) => {
  const secret = process.env.PADDLE_WEBHOOK_SECRET?.trim();
  if (!secret) return c.json({ error: "billing is not configured" }, 503);
  const rawBody = await c.req.text();
  const signature = c.req.header("paddle-signature") || "";
  if (!verifyPaddleWebhook(rawBody, signature, secret)) return c.json({ error: "invalid signature" }, 400);
  try {
    await handlePaddleWebhook(systemPrisma, JSON.parse(rawBody));
    return c.json({ ok: true });
  } catch (error) {
    console.error("Paddle webhook failed", error instanceof Error ? error.message : "unknown error");
    return c.json({ error: "webhook processing failed" }, 500);
  }
});

app.post("/v1/account/bootstrap", async (c) => {
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const account = await provisionAccount(systemPrisma, {
      authUserId: session.user.id,
      email: session.user.email,
      displayName: session.user.name,
    });
    return c.json({
      user: {
        id: account.user.id,
        email: account.user.email,
        enabled: betaAccessEnabled(account.user.enabled),
        betaAccess: account.user.enabled,
      },
      billing: await billingStatus(account.user.id),
      workspace: {
        id: account.workspace.id,
        name: account.workspace.name,
        indexedNotes: await withTenantTransaction(systemPrisma, account.workspace.id, (tx) => tx.vaultDocument.count()),
      },
    });
  } catch (error) {
    console.error("Account bootstrap rejected", error instanceof Error ? error.message : "unknown error");
    return c.json({ error: "unauthorized" }, 401);
  }
});

async function billingStatus(userId: string) {
  const subscriptions = await systemPrisma.paddleSubscription.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, select: { status: true, priceId: true, nextBilledAt: true, canceledAt: true, paddleSubscriptionId: true } });
  return {
    configured: paddleClientConfigured(),
    availablePlans: paddlePlanAvailability(),
    active: hasActivePaddleSubscription(subscriptions.map((item) => item.status)),
    subscription: subscriptions[0] ? {
      ...subscriptions[0],
      plan: paddlePlanFromPriceId(subscriptions[0].priceId),
      interval: paddleBillingIntervalFromPriceId(subscriptions[0].priceId),
      noteLimit: paddleNoteLimit(subscriptions[0].priceId),
      nextBilledAt: subscriptions[0].nextBilledAt?.toISOString() ?? null,
      canceledAt: subscriptions[0].canceledAt?.toISOString() ?? null,
    } : null,
  };
}

app.post("/v1/billing/checkout", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json<{ plan?: string; interval?: string }>().catch(() => ({} as { plan?: string; interval?: string }));
  const plan = body.plan === "deep" || body.plan === "archive" ? body.plan : "personal";
  const interval: PaddleBillingInterval = body.interval === "yearly" ? "yearly" : "monthly";
  if (!paddleConfigured(plan, interval)) return c.json({ error: "this subscription plan is not configured" }, 503);
  try {
    return c.json({ transactionId: await createPaddleTransaction(session.user.id, plan, interval) });
  } catch (error) {
    console.error("Paddle checkout creation failed", error instanceof Error ? error.message : "unknown error");
    return c.json({ error: "Unable to start checkout" }, 502);
  }
});

app.post("/v1/billing/cancel", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const subscription = await systemPrisma.paddleSubscription.findFirst({
    where: { userId: session.user.id, status: { in: ["active", "trialing"] }, canceledAt: null },
    orderBy: { updatedAt: "desc" },
  });
  if (!subscription) return c.json({ error: "no active subscription" }, 404);
  try {
    await cancelPaddleSubscription(subscription.paddleSubscriptionId);
    return c.json({ ok: true });
  } catch (error) {
    console.error("Paddle subscription cancellation failed", error instanceof Error ? error.message : "unknown error");
    return c.json({ error: "Unable to cancel subscription" }, 502);
  }
});

app.post("/v1/beta/activate", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json<{ code?: string }>().catch(() => ({} as { code?: string }));
  const code = typeof body.code === "string" ? body.code : "";
  try {
    return c.json(await activateBetaAccess(systemPrisma, {
      userId: session.user.id,
      code,
    }));
  } catch (error) {
    if (error instanceof BetaCodeError) {
      return c.json({ error: error.message }, 400);
    }
    console.error("Beta activation failed", error instanceof Error ? error.message : "unknown error");
    return c.json({ error: "Unable to activate beta access" }, 500);
  }
});

app.post("/v1/desktop-authorizations", async (c) => {
  const body = await c.req.json<{
    redirectUri?: string;
    state?: string;
    codeChallenge?: string;
    deviceName?: string;
  }>().catch(() => ({} as {
    redirectUri?: string;
    state?: string;
    codeChallenge?: string;
    deviceName?: string;
  }));
  const redirectUri = validLoopbackRedirect(body.redirectUri);
  const state = typeof body.state === "string" ? body.state : "";
  const codeChallenge = typeof body.codeChallenge === "string" ? body.codeChallenge : "";
  if (!redirectUri || !/^[A-Za-z0-9_-]{43,128}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
    return c.json({ error: "invalid desktop authorization request" }, 400);
  }

  const requestToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await systemPrisma.desktopAuthorization.deleteMany({
    where: { OR: [{ consumedAt: { not: null } }, { expiresAt: { lt: new Date() } }] },
  });
  await systemPrisma.desktopAuthorization.create({
    data: {
      requestTokenHash: sha256(requestToken),
      codeChallenge,
      state,
      redirectUri,
      deviceName: body.deviceName?.trim().slice(0, 100) || "Sillage desktop",
      expiresAt,
    },
  });
  const siteURL = process.env.SITE_URL ?? "http://localhost:3000";
  const authorizationURL = new URL("/authorize-desktop", siteURL);
  authorizationURL.searchParams.set("request", requestToken);
  return c.json({ authorizationURL: authorizationURL.toString(), expiresAt: expiresAt.toISOString() });
});

app.post("/v1/desktop-authorizations/exchange", async (c) => {
  const body = await c.req.json<{ code?: string; codeVerifier?: string }>()
    .catch(() => ({} as { code?: string; codeVerifier?: string }));
  const code = typeof body.code === "string" ? body.code : "";
  const codeVerifier = typeof body.codeVerifier === "string" ? body.codeVerifier : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(code) || !/^[A-Za-z0-9_-]{43,128}$/.test(codeVerifier)) {
    return c.json({ error: "invalid or expired authorization" }, 400);
  }

  const now = new Date();
  const token = randomBytes(32).toString("base64url");
  const result = await systemPrisma.$transaction(async (tx) => {
    const pending = await tx.desktopAuthorization.findUnique({
      where: { authorizationCodeHash: sha256(code) },
    });
    if (
      !pending
      || pending.codeChallenge !== sha256Base64URL(codeVerifier)
      || !pending.userId
      || !pending.workspaceId
      || !pending.authorizedAt
      || pending.consumedAt
      || pending.expiresAt <= now
    ) return null;
    const consumed = await tx.desktopAuthorization.updateMany({
      where: { id: pending.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) return null;
    return tx.desktopSession.create({
      data: {
        tokenHash: sha256(token),
        userId: pending.userId,
        workspaceId: pending.workspaceId,
        deviceName: pending.deviceName,
        expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
      },
    });
  }).catch(() => null);
  if (!result) return c.json({ error: "invalid or expired authorization" }, 400);
  return c.json({ token, expiresAt: result.expiresAt.toISOString() });
});

app.post("/v1/desktop-authorizations/reject", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json<{ requestToken?: string }>().catch(() => ({} as { requestToken?: string }));
  const requestToken = typeof body.requestToken === "string" ? body.requestToken : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(requestToken)) return c.json({ error: "invalid authorization request" }, 400);
  const rejected = await systemPrisma.desktopAuthorization.updateMany({
    where: { requestTokenHash: sha256(requestToken), userId: null, authorizedAt: null, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  if (rejected.count !== 1) return c.json({ error: "invalid or expired authorization" }, 400);
  return c.json({ ok: true });
});

app.use("*", async (c, next) => {
  try {
    const internalToken = process.env.MEMORY_INTERNAL_TOKEN;
    const providedToken = c.req.header("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
    const internalTenant = c.req.header("x-sillage-tenant")?.trim();
    if (secretsMatch(internalToken, providedToken) && internalTenant) {
      const membership = await systemPrisma.membership.findFirst({
        where: { workspaceId: internalTenant },
        include: { user: true },
        orderBy: { createdAt: "asc" },
      });
      if (!membership) return c.json({ error: "unknown tenant" }, 403);
      if (!betaAccessEnabled(membership.user.enabled)) {
        return c.json({ error: "beta access required", code: "BETA_ACCESS_REQUIRED" }, 403);
      }
      if (!productAccessEnabled(membership.user.billingEnabled, membership.user.enabled)) {
        return c.json({ error: "active subscription required", code: "SUBSCRIPTION_REQUIRED" }, 403);
      }
      return runAsTenant({
        tenantId: internalTenant,
        userId: membership.userId,
        authUserId: membership.userId,
      }, next);
    }
    try {
      const identity = await auth.api.getSession({ headers: c.req.raw.headers });
      if (!identity) throw new Error("missing Better Auth session");
      const user = await systemPrisma.user.findUnique({
        where: { id: identity.user.id },
        include: { memberships: { orderBy: { createdAt: "asc" }, take: 1 } },
      });
      const membership = user?.memberships[0];
      if (!user || !membership) return c.json({ error: "account is not provisioned" }, 403);
      if (!betaAccessEnabled(user.enabled)) {
        return c.json({ error: "beta access required", code: "BETA_ACCESS_REQUIRED" }, 403);
      }
      if (!productAccessEnabled(user.billingEnabled, user.enabled)) {
        return c.json({ error: "active subscription required", code: "SUBSCRIPTION_REQUIRED" }, 403);
      }
      return runAsTenant({
        tenantId: membership.workspaceId,
        userId: user.id,
        authUserId: identity.user.id,
      }, next);
    } catch {
      const token = providedToken;
      if (!token) return c.json({ error: "unauthorized" }, 401);
      const session = await systemPrisma.desktopSession.findUnique({
        where: { tokenHash: sha256(token) },
        include: { user: true },
      });
      if (!session || session.revokedAt || session.expiresAt <= new Date()) {
        return c.json({ error: "unauthorized" }, 401);
      }
      if (!betaAccessEnabled(session.user.enabled)) {
        return c.json({ error: "beta access required", code: "BETA_ACCESS_REQUIRED" }, 403);
      }
      if (!productAccessEnabled(session.user.billingEnabled, session.user.enabled)) {
        return c.json({ error: "active subscription required", code: "SUBSCRIPTION_REQUIRED" }, 403);
      }
      void systemPrisma.desktopSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
      return runAsTenant({
        tenantId: session.workspaceId,
        userId: session.userId,
        authUserId: session.userId,
      }, next);
    }
  } catch {
    return c.json({ error: "unauthorized" }, 401);
  }
});

app.post("/v1/local-model-tasks", async (c) => {
  const body = await c.req.json<{ kind?: string; payload?: unknown }>()
    .catch(() => ({} as { kind?: string; payload?: unknown }));
  const kind = body.kind?.trim() ?? "";
  if (!LOCAL_MODEL_TASK_KINDS.has(kind) || body.payload === undefined) {
    return c.json({ error: "invalid local model task" }, 400);
  }
  const encoded = JSON.stringify(body.payload);
  if (encoded.length > 2_000_000) return c.json({ error: "local model task is too large" }, 413);
  if ((await getSettings()).ingestionProvider !== "claude-code") {
    return c.json({ error: "local model execution is not enabled" }, 409);
  }
  const task = await prisma.localModelTask.create({
    data: { kind, payload: body.payload as Prisma.InputJsonValue },
    select: { id: true, status: true },
  });
  return c.json(task, 201);
});

app.get("/v1/local-model-tasks/:id", async (c) => {
  const task = await prisma.localModelTask.findUnique({
    where: { id: c.req.param("id") },
    select: { id: true, status: true, result: true, error: true, updatedAt: true },
  });
  return task ? c.json(task) : c.json({ error: "not found" }, 404);
});

app.delete("/v1/local-model-tasks/:id", async (c) => {
  await prisma.localModelTask.deleteMany({ where: { id: c.req.param("id") } });
  return c.json({ ok: true });
});

app.post("/v1/local-model-tasks/claim", async (c) => {
  if ((await getSettings()).ingestionProvider !== "claude-code") return c.body(null, 204);
  const now = new Date();
  const task = await prisma.$transaction(async (tx) => {
    const candidate = await tx.localModelTask.findFirst({
      where: {
        OR: [
          { status: "queued" },
          { status: "leased", leaseExpiresAt: { lt: now } },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!candidate) return null;
    const leaseId = randomUUID();
    const claimed = await tx.localModelTask.updateMany({
      where: {
        id: candidate.id,
        OR: [
          { status: "queued" },
          { status: "leased", leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: "leased",
        leaseId,
        leaseExpiresAt: new Date(now.getTime() + LOCAL_MODEL_TASK_LEASE_MS),
      },
    });
    if (claimed.count !== 1) return null;
    return tx.localModelTask.findUnique({
      where: { id: candidate.id },
      select: { id: true, kind: true, payload: true, leaseId: true, leaseExpiresAt: true },
    });
  });
  return task ? c.json(task) : c.body(null, 204);
});

app.post("/v1/local-model-tasks/:id/complete", async (c) => {
  const body = await c.req.json<{ leaseId?: string; result?: unknown; error?: string }>()
    .catch(() => ({} as { leaseId?: string; result?: unknown; error?: string }));
  if (!body.leaseId || (body.result === undefined && !body.error)) {
    return c.json({ error: "leaseId and result or error are required" }, 400);
  }
  const encoded = body.result === undefined ? "" : JSON.stringify(body.result);
  if (encoded.length > 2_000_000 || (body.error?.length ?? 0) > 10_000) {
    return c.json({ error: "local model task result is too large" }, 413);
  }
  const completed = await prisma.localModelTask.updateMany({
    where: { id: c.req.param("id"), status: "leased", leaseId: body.leaseId },
    data: body.error
      ? { status: "failed", error: body.error, leaseId: null, leaseExpiresAt: null }
      : {
          status: "completed",
          result: body.result as Prisma.InputJsonValue,
          error: null,
          leaseId: null,
          leaseExpiresAt: null,
        },
  });
  return completed.count === 1 ? c.json({ ok: true }) : c.json({ error: "invalid or expired lease" }, 409);
});

app.post("/v1/desktop-authorizations/authorize", async (c) => {
  const body = await c.req.json<{ requestToken?: string }>()
    .catch(() => ({} as { requestToken?: string }));
  const requestToken = typeof body.requestToken === "string" ? body.requestToken : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(requestToken)) {
    return c.json({ error: "invalid or expired authorization" }, 400);
  }
  const context = tenantContext();
  const now = new Date();
  const pending = await systemPrisma.desktopAuthorization.findUnique({
    where: { requestTokenHash: sha256(requestToken) },
  });
  if (!pending || pending.authorizedAt || pending.consumedAt || pending.expiresAt <= now) {
    return c.json({ error: "invalid or expired authorization" }, 400);
  }
  const authorizationCode = randomBytes(32).toString("base64url");
  const authorized = await systemPrisma.desktopAuthorization.updateMany({
    where: { id: pending.id, authorizedAt: null, consumedAt: null, expiresAt: { gt: now } },
    data: {
      userId: context.userId,
      workspaceId: context.tenantId,
      authorizationCodeHash: sha256(authorizationCode),
      authorizedAt: now,
    },
  });
  if (authorized.count !== 1) return c.json({ error: "invalid or expired authorization" }, 400);
  const redirectURL = new URL(pending.redirectUri);
  redirectURL.searchParams.set("code", authorizationCode);
  redirectURL.searchParams.set("state", pending.state);
  return c.json({ redirectURL: redirectURL.toString(), deviceName: pending.deviceName });
});

app.get("/v1/account/profile", async (c) => {
  const context = tenantContext();
  const [user, subscription, indexedNotes] = await Promise.all([
    systemPrisma.user.findUnique({
      where: { id: context.userId },
      select: { id: true, name: true, email: true, image: true },
    }),
    systemPrisma.paddleSubscription.findFirst({ where: { userId: context.userId }, orderBy: { updatedAt: "desc" }, select: { status: true, priceId: true, nextBilledAt: true, canceledAt: true } }),
    prisma.vaultDocument.count(),
  ]);
  if (!user) return c.json({ error: "account not found" }, 404);
  return c.json({
    user: {
      ...user,
      billing: {
        active: subscription ? hasActivePaddleSubscription([subscription.status]) : false,
        plan: paddlePlanFromPriceId(subscription?.priceId),
        status: subscription?.status ?? null,
        indexedNotes,
        noteLimit: paddleNoteLimit(subscription?.priceId),
        nextBilledAt: subscription?.nextBilledAt?.toISOString() ?? null,
        canceledAt: subscription?.canceledAt?.toISOString() ?? null,
      },
    },
  });
});

app.delete("/v1/desktop-sessions/current", async (c) => {
  const token = c.req.header("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if (token) await systemPrisma.desktopSession.updateMany({
    where: { tokenHash: sha256(token), userId: tenantContext().userId },
    data: { revokedAt: new Date() },
  });
  return c.json({ ok: true });
});

app.get("/v1/account/export", async (c) => {
  const context = tenantContext();
  const [settings, folders, conversations, vaultActionRuns, vaultDocuments, captureJobs] = await Promise.all([
    prisma.settings.findUnique({ where: { tenantId: context.tenantId } }),
    prisma.folder.findMany(),
    prisma.conversation.findMany({ include: { messages: true, consolidationRuns: { include: { proposals: true } } } }),
    prisma.vaultActionRun.findMany({ include: { proposals: true, noteChanges: true } }),
    prisma.vaultDocument.findMany({ include: { chunks: true } }),
    prisma.captureJob.findMany(),
  ]);
  c.header("Content-Disposition", `attachment; filename="sillage-${context.tenantId}.json"`);
  return c.json({
    exportedAt: new Date().toISOString(),
    workspaceId: context.tenantId,
    settings,
    folders,
    conversations,
    vaultActionRuns,
    vaultDocuments,
    captureJobs,
  });
});

app.delete("/v1/account", async (c) => {
  const context = tenantContext();
  const membership = await systemPrisma.membership.findUnique({
    where: { userId_workspaceId: { userId: context.userId, workspaceId: context.tenantId } },
  });
  if (membership?.role !== "owner") return c.json({ error: "workspace owner required" }, 403);
  const graphResponse = await memoryFetch("/tenant", { method: "DELETE" });
  if (!graphResponse.ok) return c.json({ error: "graph deletion failed" }, 502);
  await systemPrisma.$transaction(async (tx) => {
    await tx.workspace.delete({ where: { id: context.tenantId } });
    const remaining = await tx.membership.count({ where: { userId: context.userId } });
    if (remaining === 0) await tx.user.delete({ where: { id: context.userId } });
  });
  return c.json({ ok: true });
});

// ---------- Settings ----------
const VAULT_SOURCE_TYPES = new Set(["manual", "icloud", "google_drive", "kdrive", "obsidian_sync", "cloud_connector"]);
const CONSOLIDATION_TRIGGERS = new Set(["off", "ask_on_close", "draft_automatically"]);
const THEMES = new Set(["dark", "light"]);
const INGESTION_PROVIDERS = new Set(["openrouter", "claude-code"]);
const ACCENT_COLOR = /^#[0-9a-f]{6}$/i;
const MODEL_ID = /^[a-zA-Z0-9._:-]+\/[a-zA-Z0-9._:-]+$/;
type SettingsPatch = {
  archiveAutoPurge?: boolean;
  archivePurgeDays?: number;
  vaultPath?: string;
  vaultRootPath?: string;
  vaultSourceType?: string;
  vaultSourceLabel?: string;
  syncStatus?: string;
  lastSyncCheckAt?: Date | null;
  locale?: string;
  inboxFolder?: string;
  consolidationTrigger?: string;
  onboardingStep?: number;
  onboardingCompletedAt?: Date | null;
  theme?: string;
  accentColor?: string;
  defaultModel?: string;
  claudeModel?: string;
  claudeIngestionModel?: string;
  claudeEmbeddingModel?: string;
  ingestionModel?: string;
  ingestionProvider?: string;
  embeddingModel?: string;
  memoryPresetLevel?: number;
  rerankModel?: string;
  openRouterApiKeyEncrypted?: string;
};

async function validateVaultRoot(rawPath: string) {
  const raw = rawPath.trim();
  if (!raw) return "";
  if (!path.posix.isAbsolute(raw) && !path.win32.isAbsolute(raw)) {
    throw new Error("vaultPath must be an absolute path");
  }
  return raw;
}

function publicSettings<T extends { openRouterApiKeyEncrypted: string | null }>(settings: T) {
  const { openRouterApiKeyEncrypted, ...safe } = settings;
  const vaultRootPath = "vaultRootPath" in safe && typeof safe.vaultRootPath === "string"
    ? safe.vaultRootPath || ("vaultPath" in safe && typeof safe.vaultPath === "string" ? safe.vaultPath : "")
    : "";
  return {
    ...safe,
    hasOpenRouterApiKey: Boolean(openRouterApiKeyEncrypted),
    vaultPath: "vaultPath" in safe && typeof safe.vaultPath === "string" ? safe.vaultPath || vaultRootPath : vaultRootPath,
    vaultRootPath,
    vaultSourceLabel: "vaultSourceLabel" in safe && typeof safe.vaultSourceLabel === "string"
      ? safe.vaultSourceLabel || ("vaultSourceType" in safe && typeof safe.vaultSourceType === "string" ? safe.vaultSourceType : "manual")
      : "manual",
  };
}

async function getSettings() {
  const { tenantId } = tenantContext();
  const settings = await prisma.settings.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
  const vaultRootPath = settings.vaultRootPath || settings.vaultPath || "";
  const resolvedInboxFolder = vaultRootPath ? settings.inboxFolder : "";
  return {
    ...publicSettings(settings),
    resolvedInboxFolder,
    inboxFolderAvailable: Boolean(vaultRootPath),
  };
}

async function forgetConversationMemory(id: string) {
  try {
    await memoryFetch(`/conversation-memory?conversation_id=${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    /* memory service may be down; Postgres remains the source of truth */
  }
}

/** Permanently drop archived conversations past the retention window, but only
 * when the user opted into auto-purge. Cheap; safe to call often. */
async function purgeExpired() {
  const s = await getSettings();
  if (!s.archiveAutoPurge) return 0;
  const cutoff = new Date(Date.now() - s.archivePurgeDays * 86_400_000);
  const expired = await prisma.conversation.findMany({
    where: { archivedAt: { not: null, lt: cutoff } },
    select: { id: true },
  });
  if (expired.length) {
    await prisma.captureJob.updateMany({
      where: { conversationId: { in: expired.map((conversation) => conversation.id) } },
      data: { conversationId: null },
    });
  }
  const { count } = await prisma.conversation.deleteMany({
    where: { archivedAt: { not: null, lt: cutoff } },
  });
  await Promise.all(expired.map((c) => forgetConversationMemory(c.id)));
  return count;
}

async function sweepExpiredForAllTenants() {
  const workspaces = await systemPrisma.workspace.findMany({
    select: { id: true, memberships: { orderBy: { createdAt: "asc" }, take: 1, select: { userId: true } } },
  });
  for (const workspace of workspaces) {
    const membership = workspace.memberships[0];
    if (!membership) continue;
    await runAsTenant({
      tenantId: workspace.id,
      userId: membership.userId,
      authUserId: membership.userId,
    }, purgeExpired);
  }
}

app.get("/settings", async (c) => c.json(await getSettings()));

app.patch("/settings", async (c) => {
  const body = await c.req.json<{
    archiveAutoPurge?: boolean;
    archivePurgeDays?: number;
    vaultPath?: string;
    vaultRootPath?: string;
    vaultSourceType?: string;
    vaultSourceLabel?: string;
    syncStatus?: string;
    lastSyncCheckAt?: string | null;
    locale?: string;
    inboxFolder?: string;
    consolidationTrigger?: string;
    onboardingStep?: number;
    onboardingComplete?: boolean;
    theme?: string;
    accentColor?: string;
    defaultModel?: string;
    claudeModel?: string;
    claudeIngestionModel?: string;
    claudeEmbeddingModel?: string;
    ingestionModel?: string;
    ingestionProvider?: string;
    embeddingModel?: string;
    memoryPresetLevel?: number;
    rerankModel?: string;
    openRouterApiKey?: string;
  }>();
  const data: SettingsPatch = {};
  if (body.archiveAutoPurge !== undefined) data.archiveAutoPurge = body.archiveAutoPurge;
  if (body.archivePurgeDays !== undefined) data.archivePurgeDays = Math.max(1, body.archivePurgeDays);
  if (body.vaultSourceType !== undefined) {
    const sourceType = body.vaultSourceType.trim();
    if (!VAULT_SOURCE_TYPES.has(sourceType)) {
      return c.json({ error: "vaultSourceType is not supported" }, 400);
    }
    data.vaultSourceType = sourceType;
  }
  const nextVaultPath = body.vaultRootPath ?? body.vaultPath;
  if (nextVaultPath !== undefined) {
    try {
      const root = await validateVaultRoot(nextVaultPath);
      data.vaultRootPath = root;
      data.vaultPath = root;
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "vaultPath is invalid" }, 400);
    }
  }
  if (body.vaultSourceLabel !== undefined) data.vaultSourceLabel = body.vaultSourceLabel.trim();
  if (body.syncStatus !== undefined) data.syncStatus = body.syncStatus.trim() || "unknown";
  if (body.lastSyncCheckAt !== undefined) {
    data.lastSyncCheckAt = body.lastSyncCheckAt ? new Date(body.lastSyncCheckAt) : null;
  }
  if (body.locale !== undefined) data.locale = body.locale;
  if (body.inboxFolder !== undefined) {
    const inboxFolder = body.inboxFolder.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    if (inboxFolder.split("/").includes("..")) return c.json({ error: "inboxFolder must stay inside the vault" }, 400);
    data.inboxFolder = inboxFolder;
  }
  if (body.consolidationTrigger !== undefined) {
    if (!CONSOLIDATION_TRIGGERS.has(body.consolidationTrigger)) {
      return c.json({ error: "consolidationTrigger is not supported" }, 400);
    }
    data.consolidationTrigger = body.consolidationTrigger;
  }
  if (body.onboardingStep !== undefined) {
    if (!Number.isInteger(body.onboardingStep) || body.onboardingStep < 0 || body.onboardingStep > 5) {
      return c.json({ error: "onboardingStep is invalid" }, 400);
    }
    data.onboardingStep = body.onboardingStep;
  }
  if (body.theme !== undefined) {
    if (!THEMES.has(body.theme)) return c.json({ error: "theme is not supported" }, 400);
    data.theme = body.theme;
  }
  if (body.accentColor !== undefined) {
    if (!ACCENT_COLOR.test(body.accentColor)) return c.json({ error: "accentColor must be a hex color" }, 400);
    data.accentColor = body.accentColor.toUpperCase();
  }
  if (body.defaultModel !== undefined) {
    const model = body.defaultModel.trim();
    if (!MODEL_ID.test(model) || model.length > 180) return c.json({ error: "defaultModel is invalid" }, 400);
    data.defaultModel = model;
  }
  if (body.claudeModel !== undefined) {
    if (!new Set(["default", "sonnet", "opus", "fable"]).has(body.claudeModel)) {
      return c.json({ error: "claudeModel is invalid" }, 400);
    }
    data.claudeModel = body.claudeModel;
  }
  if (body.claudeIngestionModel !== undefined) {
    if (!new Set(["default", "sonnet", "opus", "fable"]).has(body.claudeIngestionModel)) {
      return c.json({ error: "claudeIngestionModel is invalid" }, 400);
    }
    data.claudeIngestionModel = body.claudeIngestionModel;
  }
  if (body.claudeEmbeddingModel !== undefined) {
    if (!new Set(["multilingual-e5-small", "multilingual-e5-base"]).has(body.claudeEmbeddingModel)) {
      return c.json({ error: "claudeEmbeddingModel is invalid" }, 400);
    }
    data.claudeEmbeddingModel = body.claudeEmbeddingModel;
  }
  if (body.ingestionModel !== undefined) {
    const model = body.ingestionModel.trim();
    if (!MODEL_ID.test(model) || model.length > 180) return c.json({ error: "ingestionModel is invalid" }, 400);
    data.ingestionModel = model;
  }
  if (body.ingestionProvider !== undefined) {
    if (!INGESTION_PROVIDERS.has(body.ingestionProvider)) {
      return c.json({ error: "ingestionProvider is not supported" }, 400);
    }
    data.ingestionProvider = body.ingestionProvider;
  }
  if (body.embeddingModel !== undefined) {
    const model = body.embeddingModel.trim();
    if (!MODEL_ID.test(model) || model.length > 180) return c.json({ error: "embeddingModel is invalid" }, 400);
    data.embeddingModel = model;
  }
  if (body.memoryPresetLevel !== undefined) {
    if (!Number.isInteger(body.memoryPresetLevel) || body.memoryPresetLevel < 0 || body.memoryPresetLevel > 4) {
      return c.json({ error: "memoryPresetLevel is invalid" }, 400);
    }
    data.memoryPresetLevel = body.memoryPresetLevel;
  }
  if (body.rerankModel !== undefined) {
    const model = body.rerankModel.trim();
    if (!MODEL_ID.test(model) || model.length > 180) return c.json({ error: "rerankModel is invalid" }, 400);
    data.rerankModel = model;
  }
  if (body.openRouterApiKey !== undefined) {
    const apiKey = body.openRouterApiKey.trim();
    if (!apiKey.startsWith("sk-or-") || apiKey.length > 300) return c.json({ error: "OpenRouter API key is invalid" }, 400);
    const keyResponse = await fetch(`${OPENROUTER_API}/key`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    }).catch(() => null);
    if (!keyResponse) return c.json({ error: "Unable to reach OpenRouter" }, 502);
    if (!keyResponse.ok) return c.json({ error: "OpenRouter rejected this API key" }, 401);
    data.openRouterApiKeyEncrypted = encryptSetting(apiKey);
  }
  if (body.onboardingComplete === true) {
    data.onboardingStep = 5;
    data.onboardingCompletedAt = new Date();
  }
  const { tenantId } = tenantContext();
  const s = await prisma.settings.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
  return c.json(publicSettings(s));
});

app.post("/v1/openrouter/validate", async (c) => {
  const { apiKey } = await c.req.json<{ apiKey?: string }>();
  const key = apiKey?.trim() ?? "";
  if (!key.startsWith("sk-or-") || key.length > 300) return c.json({ error: "OpenRouter API key is invalid" }, 400);
  const headers = { Authorization: `Bearer ${key}` };
  const keyResponse = await fetch(`${OPENROUTER_API}/key`, { headers });
  if (!keyResponse.ok) return c.json({ error: "OpenRouter rejected this API key" }, 401);
  const keyInfo = await keyResponse.json() as { data?: { label?: string; limit?: number | null; usage?: number } };
  try {
    return c.json({ key: keyInfo.data ?? {}, ...await loadOpenRouterCatalog(key) });
  } catch {
    return c.json({ error: "Unable to load OpenRouter models" }, 502);
  }
});

app.get("/v1/openrouter/catalog", async (c) => {
  const { tenantId } = tenantContext();
  const settings = await prisma.settings.findUnique({
    where: { tenantId },
    select: { openRouterApiKeyEncrypted: true },
  });
  if (!settings?.openRouterApiKeyEncrypted) return c.json({ error: "OpenRouter is not connected" }, 409);
  try {
    return c.json(await loadOpenRouterCatalog(decryptSetting(settings.openRouterApiKeyEncrypted)));
  } catch {
    return c.json({ error: "Unable to load OpenRouter models" }, 502);
  }
});

// ---------- Folders ----------
app.get("/folders", async (c) => {
  const folders = await prisma.folder.findMany({ orderBy: { name: "asc" } });
  return c.json(folders);
});

app.post("/folders", async (c) => {
  const { name, icon } = await c.req.json<{ name: string; icon?: string }>();
  const folder = await prisma.folder.create({
    data: { name: name?.trim() || "Nouveau dossier", icon: icon?.trim() || "folder" },
  });
  return c.json(folder);
});

app.patch("/folders/:id", async (c) => {
  const body = await c.req.json<{ name?: string; icon?: string }>();
  const data: { name?: string; icon?: string } = {};
  if (body.name !== undefined) data.name = body.name.trim();
  if (body.icon !== undefined) data.icon = body.icon.trim() || "folder";
  const folder = await prisma.folder.update({
    where: { id: c.req.param("id") },
    data,
  });
  return c.json(folder);
});

// Delete a folder; its conversations fall back to "no folder" (SetNull).
app.delete("/folders/:id", async (c) => {
  const id = c.req.param("id");
  await prisma.$transaction(async (tx) => {
    await tx.conversation.updateMany({ where: { folderId: id }, data: { folderId: null } });
    await tx.folder.delete({ where: { id } });
  });
  return c.json({ ok: true });
});

// ---------- Conversations ----------
// Active (non-archived) conversations, newest first. The client groups them by
// folderId in the sidebar.
app.get("/conversations", async (c) => {
  const convos = await prisma.conversation.findMany({
    where: { archivedAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, updatedAt: true, folderId: true, mode: true },
  });
  return c.json(convos);
});

// Archived conversations + how long until auto-purge removes them (if enabled).
app.get("/conversations/archived", async (c) => {
  await purgeExpired();
  const s = await getSettings();
  const convos = await prisma.conversation.findMany({
    where: { archivedAt: { not: null } },
    orderBy: { archivedAt: "desc" },
    select: { id: true, title: true, archivedAt: true, folderId: true },
  });
  const items = convos.map((cv) => {
    let daysLeft: number | null = null;
    if (s.archiveAutoPurge && cv.archivedAt) {
      const expires = cv.archivedAt.getTime() + s.archivePurgeDays * 86_400_000;
      daysLeft = Math.max(0, Math.ceil((expires - Date.now()) / 86_400_000));
    }
    return { ...cv, daysLeft };
  });
  return c.json({ items, autoPurge: s.archiveAutoPurge, purgeDays: s.archivePurgeDays });
});

app.post("/conversations", async (c) => {
  const { title, folderId, mode } = await c.req.json<{
    title: string;
    folderId?: string | null;
    mode?: ConversationMode;
  }>();
  const convo = await prisma.conversation.create({
    data: { title: title || "New conversation", folderId: folderId ?? null, mode: conversationMode(mode) },
  });
  return c.json(convo);
});

app.get("/conversations/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const limit = Math.max(1, Math.min(Number(c.req.query("limit") ?? 5), 5));
  if (!q) return c.json({ conversations: [] });
  const conversations = await prisma.conversation.findMany({
    where: {
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { messages: { some: { text: { contains: q, mode: "insensitive" } } } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      updatedAt: true,
      archivedAt: true,
      messages: {
        where: { text: { contains: q, mode: "insensitive" } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { text: true },
      },
    },
  });
  return c.json({
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt,
      archivedAt: conversation.archivedAt,
      snippet: conversation.messages[0]?.text.slice(0, 240) ?? "",
    })),
  });
});

app.get("/conversations/:id", async (c) => {
  const convo = await prisma.conversation.findUnique({
    where: { id: c.req.param("id") },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        include: {
          noteChanges: { orderBy: { createdAt: "asc" } },
          vaultDrafts: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!convo) return c.json({ error: "not found" }, 404);

  const legacyFacts = convo.messages.flatMap((message) => Array.isArray(message.facts) ? message.facts : []);
  const sources = await resolveLegacyFactSources(legacyFacts);

  const updates: Array<Promise<unknown>> = [];
  const messages = convo.messages.map((message) => {
    let factsChanged = false;
    const facts = Array.isArray(message.facts) ? message.facts.map((value) => {
      const record = jsonRecord(value);
      if (!record || typeof record.fact !== "string" || record.source_type) return value;
      const source = sources.get(record.fact);
      if (!source) return value;
      factsChanged = true;
      return { ...record, ...source };
    }) : message.facts;
    const structuredSources = message.sources === null
      ? normalizeKnowledgeSources([
          messageProvenance(message.role === "user" ? "user" : "brain", message.id),
          ...knowledgeSourcesFromFacts(facts),
        ])
      : normalizeKnowledgeSources(message.sources);
    const sourcesChanged = message.sources === null;
    if (factsChanged || sourcesChanged) {
      updates.push(prisma.message.update({
        where: { id: message.id },
        data: {
          ...(factsChanged ? { facts: facts as Prisma.InputJsonValue } : {}),
          ...(sourcesChanged ? { sources: structuredSources as Prisma.InputJsonValue } : {}),
        },
      }));
    }
    return { ...message, facts, sources: structuredSources };
  });
  await Promise.all(updates);
  return c.json({ ...convo, messages });
});

async function createVaultDraft(messageId: string, regenerate = false) {
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message || message.role !== "brain") return null;
  if (!regenerate) {
    const existing = await prisma.vaultDraft.findFirst({
      where: { messageId, status: { in: ["draft", "applying", "applied_pending_sync", "synced"] } },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return existing;
  }

  const sources = normalizeKnowledgeSources(message.sources);
  const settings = await getSettings();
  const response = await memoryFetch("/knowledge/save-draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message_id: message.id,
      text: message.text,
      sources,
      inbox_folder: settings.resolvedInboxFolder,
    }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { detail?: string; error?: string };
    throw new Error(result.detail || result.error || "The vault draft could not be generated.");
  }
  const generated = await response.json() as SaveDraftResponse;
  const title = safeNoteFileName(generated.title);
  return prisma.vaultDraft.create({
    data: {
      messageId: message.id,
      conversationId: message.conversationId,
      title,
      targetPath: draftTargetPath(generated.target_folder, title),
      content: generated.markdown,
      rationale: generated.rationale,
      sources: sources as Prisma.InputJsonValue,
      beforeHash: null,
    },
  });
}

app.post("/messages/:messageId/save-to-vault", async (c) => {
  const body: { regenerate?: boolean } = await c.req.json<{ regenerate?: boolean }>().catch(() => ({}));
  try {
    const draft = await createVaultDraft(c.req.param("messageId"), Boolean(body.regenerate));
    return draft ? c.json(draft, 201) : c.json({ error: "assistant message not found" }, 404);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "draft generation failed" }, 502);
  }
});

app.patch("/vault-drafts/:id", async (c) => {
  const body = await c.req.json<{ title?: string; targetPath?: string; content?: string }>();
  const existing = await prisma.vaultDraft.findUnique({ where: { id: c.req.param("id") } });
  if (!existing) return c.json({ error: "draft not found" }, 404);
  if (existing.status !== "draft") return c.json({ error: "only pending drafts can be edited" }, 409);
  const data: { title?: string; targetPath?: string; content?: string } = {};
  if (body.title !== undefined) data.title = safeNoteFileName(body.title);
  if (body.targetPath !== undefined) {
    const value = body.targetPath.trim().replaceAll("\\", "/");
    if (!value.endsWith(".md") || path.posix.isAbsolute(value) || value.split("/").includes("..")) {
      return c.json({ error: "targetPath must be a safe vault-relative Markdown path" }, 400);
    }
    data.targetPath = value;
  }
  if (body.content !== undefined) data.content = body.content.slice(0, 200_000);
  return c.json(await prisma.vaultDraft.update({ where: { id: existing.id }, data }));
});

app.post("/vault-drafts/:id/apply", async (c) => {
  const body = await c.req.json<{ confirmedCurator?: boolean }>();
  if (!body.confirmedCurator) return c.json({ error: "explicit Curator confirmation is required" }, 403);
  const draft = await prisma.vaultDraft.findUnique({ where: { id: c.req.param("id") } });
  if (!draft) return c.json({ error: "draft not found" }, 404);
  if (draft.status !== "draft" && draft.status !== "failed") {
    return c.json({ error: "draft cannot be applied in its current state" }, 409);
  }
  await prisma.vaultDraft.update({ where: { id: draft.id }, data: { status: "applying" } });
  const response = await memoryFetch("/vault/changes/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      target_path: draft.targetPath,
      content: draft.content,
      before_hash: draft.beforeHash,
      confirmed: true,
    }),
  });
  const result = await response.json().catch(() => ({})) as { status?: string; error?: string; detail?: string };
  if (!response.ok) {
    const stale = response.status === 409;
    const failed = await prisma.vaultDraft.update({
      where: { id: draft.id },
      data: { status: stale ? "stale" : "failed" },
    });
    return c.json({ ...failed, error: result.detail || result.error || "apply failed" }, response.status === 409 ? 409 : 502);
  }
  const status = result.status === "synced" ? "synced" : "applied_pending_sync";
  const applied = await prisma.$transaction(async (tx) => {
    const updated = await tx.vaultDraft.update({ where: { id: draft.id }, data: { status, appliedAt: new Date() } });
    await tx.noteChange.create({
      data: {
        conversationId: draft.conversationId,
        messageId: draft.messageId,
        kind: "created",
        noteTitle: draft.title,
        notePath: draft.targetPath,
        beforeContent: "",
        afterContent: draft.content,
        addedLines: draft.content.split("\n").filter(Boolean).length,
        removedLines: 0,
      },
    });
    return updated;
  });
  return c.json(applied);
});

const VAULT_ACTIONS = new Set(["organize_folder", "restructure_note", "rewrite_note", "structure_idea"]);

type GeneratedVaultProposal = {
  kind: "create" | "update" | "move" | "merge" | "delete";
  target_path: string;
  source_paths?: unknown[];
  before_hash?: string | null;
  before_content?: string;
  after_content: string;
  rationale: string;
  confidence: string;
  risk?: string;
  sources?: unknown[];
};

function memoryErrorMessage(result: unknown, fallback: string): { message: string; code?: string; detail?: unknown } {
  const record = jsonRecord(result);
  const detail = jsonRecord(record?.detail);
  return {
    message: optionalString(detail?.message) || optionalString(record?.error) || optionalString(record?.detail) || fallback,
    code: optionalString(detail?.code),
    detail: detail ?? record?.detail,
  };
}

app.post("/vault/action-runs", async (c) => {
  const body = await c.req.json<{
    action?: string;
    targetPath?: string;
    instruction?: string;
    ideaText?: string;
    destinationFolder?: string;
  }>();
  const action = body.action?.trim() ?? "";
  if (!VAULT_ACTIONS.has(action)) return c.json({ error: "unsupported vault action" }, 400);
  const targetPath = body.targetPath?.trim().replaceAll("\\", "/") || null;
  const instruction = body.instruction?.trim() ?? "";
  const ideaText = body.ideaText?.trim() ?? "";
  const settings = await getSettings();
  const destinationFolder = (body.destinationFolder ?? settings.resolvedInboxFolder).trim().replaceAll("\\", "/");
  if (instruction.length > 2_000) return c.json({ error: "instruction is too long" }, 400);
  if (ideaText.length > 120_000) return c.json({ error: "idea is too long", code: "scope_too_large" }, 413);
  if (action === "structure_idea" && !ideaText) return c.json({ error: "idea text is required" }, 400);
  if (action !== "structure_idea" && !targetPath) return c.json({ error: "a vault target is required" }, 400);
  if (action === "rewrite_note" && !instruction) return c.json({ error: "an instruction is required" }, 400);
  if (destinationFolder.split("/").includes("..") || path.posix.isAbsolute(destinationFolder)) {
    return c.json({ error: "destination folder must stay inside the vault" }, 400);
  }

  const run = await prisma.vaultActionRun.create({
    data: { action, targetPath, instruction, inputText: ideaText, destinationFolder, status: "generating" },
  });
  const response = await memoryFetch("/vault/actions/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      target_path: targetPath,
      instruction,
      idea_text: ideaText,
      destination_folder: destinationFolder,
    }),
  });
  const generated = await response.json().catch(() => ({})) as {
    summary?: string;
    proposals?: GeneratedVaultProposal[];
    detail?: unknown;
    error?: string;
  };
  if (!response.ok || !Array.isArray(generated.proposals)) {
    const failure = memoryErrorMessage(generated, "vault action generation failed");
    await prisma.vaultActionRun.update({
      where: { id: run.id },
      data: { status: "failed", errorCode: failure.code, errorDetail: failure.message },
    });
    return c.json({ error: failure.message, code: failure.code, detail: failure.detail, runId: run.id }, response.status === 413 ? 413 : 502);
  }
  if (generated.proposals.length === 0) {
    await prisma.vaultActionRun.update({
      where: { id: run.id },
      data: { status: "failed", errorCode: "no_changes", errorDetail: "No reliable vault changes were generated." },
    });
    return c.json({ error: "No reliable vault changes were generated.", code: "no_changes", runId: run.id }, 422);
  }
  const proposals = generated.proposals;
  await prisma.$transaction(async (tx) => {
    await tx.vaultActionRun.update({
      where: { id: run.id },
      data: { status: "draft", summary: generated.summary?.trim() || "Vault action review" },
    });
    for (const proposal of proposals.slice(0, 20)) {
      await tx.knowledgeProposal.create({
        data: {
          vaultActionRunId: run.id,
          kind: proposal.kind,
          targetPath: proposal.target_path,
          sourcePaths: (proposal.source_paths ?? []) as Prisma.InputJsonValue,
          beforeHash: proposal.before_hash ?? null,
          beforeContent: proposal.before_content ?? "",
          afterContent: proposal.after_content.slice(0, 200_000),
          rationale: proposal.rationale.slice(0, 10_000),
          confidence: ["low", "medium", "high"].includes(proposal.confidence) ? proposal.confidence : "medium",
          risk: proposal.risk === "structural" || proposal.risk === "destructive" ? proposal.risk : "safe",
          sources: normalizeKnowledgeSources(proposal.sources) as Prisma.InputJsonValue,
        },
      });
    }
  });
  return c.json(await prisma.vaultActionRun.findUnique({
    where: { id: run.id },
    include: { proposals: { orderBy: { createdAt: "asc" } } },
  }), 201);
});

app.get("/vault/action-runs/:id", async (c) => {
  const run = await prisma.vaultActionRun.findUnique({
    where: { id: c.req.param("id") },
    include: { proposals: { orderBy: { createdAt: "asc" } } },
  });
  return run ? c.json(run) : c.json({ error: "review not found" }, 404);
});

app.patch("/vault/action-runs/:id/proposals/:proposalId", async (c) => {
  const body = await c.req.json<{ decision?: string; afterContent?: string; targetPath?: string }>();
  const proposal = await prisma.knowledgeProposal.findFirst({
    where: { id: c.req.param("proposalId"), vaultActionRunId: c.req.param("id") },
    include: { vaultActionRun: true },
  });
  if (!proposal || !proposal.vaultActionRun) return c.json({ error: "proposal not found" }, 404);
  if (proposal.vaultActionRun.resolvedAt || ["synced", "applied_pending_sync"].includes(proposal.applyStatus)) {
    return c.json({ error: "proposal can no longer be edited" }, 409);
  }
  const data: { decision?: string; afterContent?: string; targetPath?: string } = {};
  if (body.decision !== undefined) {
    if (!["pending", "accepted", "rejected"].includes(body.decision)) return c.json({ error: "invalid decision" }, 400);
    data.decision = body.decision;
  }
  if (body.afterContent !== undefined) data.afterContent = body.afterContent.slice(0, 200_000);
  if (body.targetPath !== undefined) {
    const value = body.targetPath.trim().replaceAll("\\", "/");
    if (!value.endsWith(".md") || path.posix.isAbsolute(value) || value.split("/").includes("..")) {
      return c.json({ error: "invalid vault-relative Markdown path" }, 400);
    }
    data.targetPath = value;
  }
  return c.json(await prisma.knowledgeProposal.update({ where: { id: proposal.id }, data }));
});

app.post("/vault/action-runs/:id/proposals/:proposalId/refine", async (c) => {
  const body = await c.req.json<{
    instruction?: string;
    selectedSide?: "before" | "after";
    selectedStartLine?: number;
    selectedEndLine?: number;
  }>();
  const instruction = body.instruction?.trim() ?? "";
  if (!instruction || instruction.length > 2_000) return c.json({ error: "a valid instruction is required" }, 400);
  if (body.selectedSide !== "before" && body.selectedSide !== "after") return c.json({ error: "invalid selected side" }, 400);
  if (!Number.isInteger(body.selectedStartLine) || !Number.isInteger(body.selectedEndLine)) {
    return c.json({ error: "a valid line range is required" }, 400);
  }
  const proposal = await prisma.knowledgeProposal.findFirst({
    where: { id: c.req.param("proposalId"), vaultActionRunId: c.req.param("id") },
    include: { vaultActionRun: true },
  });
  if (!proposal || !proposal.vaultActionRun) return c.json({ error: "proposal not found" }, 404);
  if (proposal.vaultActionRun.resolvedAt || ["synced", "applied_pending_sync"].includes(proposal.applyStatus)) {
    return c.json({ error: "proposal can no longer be edited" }, 409);
  }
  const response = await memoryFetch("/knowledge/refine-proposal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      target_path: proposal.targetPath,
      before_content: proposal.beforeContent,
      after_content: proposal.afterContent,
      instruction,
      selected_side: body.selectedSide,
      selected_start_line: body.selectedStartLine,
      selected_end_line: body.selectedEndLine,
      rationale: proposal.rationale,
      sources: normalizeKnowledgeSources(proposal.sources),
    }),
  });
  const refined = await response.json().catch(() => ({})) as { after_content?: string; rationale?: string; detail?: string };
  if (!response.ok || !refined.after_content?.trim()) {
    return c.json({ error: refined.detail || "proposal refinement failed" }, 502);
  }
  return c.json(await prisma.knowledgeProposal.update({
    where: { id: proposal.id },
    data: {
      afterContent: refined.after_content.slice(0, 200_000),
      rationale: refined.rationale?.trim().slice(0, 10_000) || proposal.rationale,
      decision: "pending",
    },
  }));
});

app.post("/vault/action-runs/:id/apply", async (c) => {
  const body = await c.req.json<{ confirmedCurator?: boolean }>();
  if (!body.confirmedCurator) return c.json({ error: "explicit Curator confirmation is required" }, 403);
  const run = await prisma.vaultActionRun.findUnique({
    where: { id: c.req.param("id") },
    include: { proposals: { orderBy: { createdAt: "asc" } } },
  });
  if (!run || run.resolvedAt) return c.json({ error: "active review not found" }, 404);
  const accepted = run.proposals.filter((proposal) =>
    proposal.decision === "accepted" && ["pending", "failed"].includes(proposal.applyStatus)
  );
  if (accepted.length === 0) return c.json({ error: "accept at least one pending proposal first" }, 409);
  await prisma.vaultActionRun.update({ where: { id: run.id }, data: { status: "applying" } });
  const response = await memoryFetch("/vault/changes/apply-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      confirmed: true,
      changes: accepted.map((proposal) => ({
        id: proposal.id,
        kind: proposal.kind,
        target_path: proposal.targetPath,
        before_hash: proposal.beforeHash,
        after_content: proposal.afterContent,
        source_paths: Array.isArray(proposal.sourcePaths) ? proposal.sourcePaths : [],
      })),
    }),
  });
  const result = await response.json().catch(() => ({})) as {
    detail?: string;
    items?: Array<{ id: string; status: "synced" | "applied_pending_sync" }>;
  };
  if (!response.ok || !result.items) {
    const stale = response.status === 409;
    await prisma.$transaction(async (tx) => {
      await tx.vaultActionRun.update({ where: { id: run.id }, data: { status: stale ? "stale" : "failed" } });
      await tx.knowledgeProposal.updateMany({
        where: { id: { in: accepted.map((proposal) => proposal.id) } },
        data: { applyStatus: stale ? "stale" : "failed" },
      });
    });
    return c.json({ error: result.detail || "batch application failed" }, stale ? 409 : 502);
  }
  const statusById = new Map(result.items.map((item) => [item.id, item.status]));
  await prisma.$transaction(async (tx) => {
    for (const proposal of accepted) {
      const applyStatus = statusById.get(proposal.id) || "applied_pending_sync";
      await tx.knowledgeProposal.update({ where: { id: proposal.id }, data: { applyStatus } });
      await tx.noteChange.create({
        data: {
          vaultActionRunId: run.id,
          kind: proposal.kind === "create" || (proposal.kind === "merge" && !proposal.beforeContent)
            ? "created" : proposal.kind === "delete" ? "deleted" : "modified",
          noteTitle: path.posix.basename(proposal.targetPath, ".md"),
          notePath: proposal.targetPath,
          beforeContent: proposal.beforeContent,
          afterContent: proposal.afterContent,
          addedLines: Math.max(0, proposal.afterContent.split("\n").length - proposal.beforeContent.split("\n").length),
          removedLines: Math.max(0, proposal.beforeContent.split("\n").length - proposal.afterContent.split("\n").length),
        },
      });
      if (proposal.kind === "move" || proposal.kind === "merge") {
        for (const raw of Array.isArray(proposal.sourcePaths) ? proposal.sourcePaths : []) {
          const snapshot = jsonRecord(raw);
          const sourcePath = optionalString(snapshot?.path);
          const sourceContent = optionalString(snapshot?.content) ?? "";
          if (!sourcePath || sourcePath === proposal.targetPath) continue;
          await tx.noteChange.create({
            data: {
              vaultActionRunId: run.id,
              kind: "deleted",
              noteTitle: path.posix.basename(sourcePath, ".md"),
              notePath: sourcePath,
              beforeContent: sourceContent,
              afterContent: "",
              addedLines: 0,
              removedLines: sourceContent.split("\n").filter(Boolean).length,
            },
          });
        }
      }
    }
  });
  const unresolved = await prisma.knowledgeProposal.count({
    where: { vaultActionRunId: run.id, decision: "pending" },
  });
  await prisma.vaultActionRun.update({
    where: { id: run.id },
    data: { status: unresolved === 0 ? "applied" : "draft", resolvedAt: unresolved === 0 ? new Date() : null },
  });
  return c.json(await prisma.vaultActionRun.findUnique({
    where: { id: run.id },
    include: { proposals: { orderBy: { createdAt: "asc" } } },
  }));
});

app.post("/vault/action-runs/:id/retry-sync", async (c) => {
  const run = await prisma.vaultActionRun.findUnique({
    where: { id: c.req.param("id") }, include: { proposals: true },
  });
  if (!run) return c.json({ error: "review not found" }, 404);
  const waiting = run.proposals.filter((proposal) => proposal.applyStatus === "applied_pending_sync");
  let synced = 0;
  const { tenantId } = tenantContext();
  for (const proposal of waiting) {
    const target = await prisma.vaultDocument.findUnique({
      where: { tenantId_path: { tenantId, path: proposal.targetPath } },
    });
    const removedPaths = (Array.isArray(proposal.sourcePaths) ? proposal.sourcePaths : []).flatMap((raw) => {
      const sourcePath = optionalString(jsonRecord(raw)?.path);
      return sourcePath && (sourcePath !== proposal.targetPath || proposal.kind === "delete") ? [sourcePath] : [];
    });
    const remaining = removedPaths.length
      ? await prisma.vaultDocument.count({ where: { path: { in: removedPaths } } }) : 0;
    if (proposalSyncComplete(proposal.kind, target?.contentHash ?? null, sha256(proposal.afterContent), remaining)) {
      await prisma.knowledgeProposal.update({ where: { id: proposal.id }, data: { applyStatus: "synced" } });
      synced += 1;
    }
  }
  return c.json({ ok: true, checked: waiting.length, synced, waiting: waiting.length - synced });
});

app.post("/vault/action-runs/:id/reject", async (c) => {
  const run = await prisma.vaultActionRun.findUnique({ where: { id: c.req.param("id") } });
  if (!run) return c.json({ error: "review not found" }, 404);
  if (run.resolvedAt) return c.json({ error: "review is already resolved" }, 409);
  const resolvedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.vaultActionRun.update({ where: { id: run.id }, data: { status: "rejected", resolvedAt } });
    await tx.knowledgeProposal.updateMany({
      where: { vaultActionRunId: run.id, decision: "pending" }, data: { decision: "rejected" },
    });
  });
  return c.json({ ok: true, status: "rejected" });
});

app.get("/conversations/:conversationId/consolidations", async (c) => {
  const runs = await prisma.consolidationRun.findMany({
    where: { conversationId: c.req.param("conversationId") },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { proposals: true } } },
  });
  return c.json({ items: runs });
});

app.post("/conversations/:conversationId/consolidations", async (c) => {
  const conversationId = c.req.param("conversationId");
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conversation) return c.json({ error: "conversation not found" }, 404);
  const messages = selectConsolidationWindow(
    conversation.messages,
    conversation.lastConsolidatedMessageId,
  );
  if (messages.length === 0) return c.json({ error: "there are no new messages to review" }, 409);
  const throughMessageId = messages[messages.length - 1].id;
  const existing = await prisma.consolidationRun.findFirst({
    where: {
      conversationId,
      fromMessageId: conversation.lastConsolidatedMessageId,
      throughMessageId,
      status: { in: ["generating", "draft", "applying", "failed", "stale"] },
    },
    include: { proposals: { orderBy: { createdAt: "asc" } } },
  });
  if (existing && shouldReuseConsolidation(existing)) return c.json(existing);
  if (existing) await prisma.consolidationRun.delete({ where: { id: existing.id } });

  const run = await prisma.consolidationRun.create({
    data: {
      conversationId,
      fromMessageId: conversation.lastConsolidatedMessageId,
      throughMessageId,
      status: "generating",
    },
  });
  const response = await memoryFetch("/knowledge/consolidate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversation_id: conversationId,
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role === "user" ? "user" : "assistant",
        text: message.text,
        sources: normalizeKnowledgeSources(message.sources),
      })),
      inbox_folder: (await getSettings()).resolvedInboxFolder,
    }),
  });
  if (!response.ok) {
    await prisma.consolidationRun.update({ where: { id: run.id }, data: { status: "failed" } });
    return c.json({ error: "consolidation generation failed" }, 502);
  }
  const generated = await response.json() as {
    summary: string;
    knowledge_delta: unknown;
    proposals: Array<{
      kind: "create" | "update" | "move" | "merge" | "delete";
      target_path: string;
      source_paths?: unknown[];
      before_hash?: string | null;
      before_content?: string;
      after_content: string;
      rationale: string;
      confidence: string;
      risk?: string;
      sources?: unknown[];
    }>;
  };
  await prisma.$transaction(async (tx) => {
    await tx.consolidationRun.update({
      where: { id: run.id },
      data: {
        status: "draft",
        summary: generated.summary || "Conversation review",
        knowledgeDelta: (generated.knowledge_delta ?? {}) as Prisma.InputJsonValue,
      },
    });
    for (const proposal of generated.proposals.slice(0, 20)) {
      await tx.knowledgeProposal.create({
        data: {
          consolidationId: run.id,
          kind: proposal.kind,
          targetPath: proposal.target_path,
          sourcePaths: (proposal.source_paths ?? []) as Prisma.InputJsonValue,
          beforeHash: proposal.before_hash ?? null,
          beforeContent: proposal.before_content ?? "",
          afterContent: proposal.after_content,
          rationale: proposal.rationale,
          confidence: ["low", "medium", "high"].includes(proposal.confidence) ? proposal.confidence : "medium",
          risk: proposal.risk === "structural" || proposal.risk === "destructive" ? proposal.risk : "safe",
          sources: normalizeKnowledgeSources(proposal.sources) as Prisma.InputJsonValue,
        },
      });
    }
  });
  const completed = await prisma.consolidationRun.findUnique({
    where: { id: run.id },
    include: { proposals: { orderBy: { createdAt: "asc" } } },
  });
  return c.json(completed, 201);
});

app.get("/consolidations/:id", async (c) => {
  const run = await prisma.consolidationRun.findUnique({
    where: { id: c.req.param("id") },
    include: { proposals: { orderBy: { createdAt: "asc" } } },
  });
  return run ? c.json(run) : c.json({ error: "review not found" }, 404);
});

app.patch("/consolidations/:id/proposals/:proposalId", async (c) => {
  const body = await c.req.json<{ decision?: string; afterContent?: string; targetPath?: string }>();
  const proposal = await prisma.knowledgeProposal.findFirst({
    where: { id: c.req.param("proposalId"), consolidationId: c.req.param("id") },
    include: { consolidation: true },
  });
  if (!proposal || !proposal.consolidation) return c.json({ error: "proposal not found" }, 404);
  if (proposal.consolidation.resolvedAt || proposal.applyStatus === "synced" || proposal.applyStatus === "applied_pending_sync") {
    return c.json({ error: "proposal can no longer be edited" }, 409);
  }
  const data: { decision?: string; afterContent?: string; targetPath?: string } = {};
  if (body.decision !== undefined) {
    if (!["pending", "accepted", "rejected"].includes(body.decision)) return c.json({ error: "invalid decision" }, 400);
    data.decision = body.decision;
  }
  if (body.afterContent !== undefined) data.afterContent = body.afterContent.slice(0, 200_000);
  if (body.targetPath !== undefined) {
    const value = body.targetPath.trim().replaceAll("\\", "/");
    if (!value.endsWith(".md") || path.posix.isAbsolute(value) || value.split("/").includes("..")) {
      return c.json({ error: "invalid vault-relative Markdown path" }, 400);
    }
    data.targetPath = value;
  }
  return c.json(await prisma.knowledgeProposal.update({ where: { id: proposal.id }, data }));
});

app.post("/consolidations/:id/proposals/:proposalId/refine", async (c) => {
  const body = await c.req.json<{
    instruction?: string;
    selectedSide?: "before" | "after";
    selectedStartLine?: number;
    selectedEndLine?: number;
  }>();
  const instruction = body.instruction?.trim() ?? "";
  if (!instruction || instruction.length > 2_000) return c.json({ error: "a valid instruction is required" }, 400);
  if (body.selectedSide !== "before" && body.selectedSide !== "after") return c.json({ error: "invalid selected side" }, 400);
  if (!Number.isInteger(body.selectedStartLine) || !Number.isInteger(body.selectedEndLine)) {
    return c.json({ error: "a valid line range is required" }, 400);
  }
  const proposal = await prisma.knowledgeProposal.findFirst({
    where: { id: c.req.param("proposalId"), consolidationId: c.req.param("id") },
    include: { consolidation: true },
  });
  if (!proposal || !proposal.consolidation) return c.json({ error: "proposal not found" }, 404);
  if (proposal.consolidation.resolvedAt || proposal.applyStatus === "synced" || proposal.applyStatus === "applied_pending_sync") {
    return c.json({ error: "proposal can no longer be edited" }, 409);
  }
  const response = await memoryFetch("/knowledge/refine-proposal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      target_path: proposal.targetPath,
      before_content: proposal.beforeContent,
      after_content: proposal.afterContent,
      instruction,
      selected_side: body.selectedSide,
      selected_start_line: body.selectedStartLine,
      selected_end_line: body.selectedEndLine,
      rationale: proposal.rationale,
      sources: normalizeKnowledgeSources(proposal.sources),
    }),
  });
  const refined = await response.json().catch(() => ({})) as { after_content?: string; rationale?: string; detail?: string };
  if (!response.ok || !refined.after_content?.trim()) {
    return c.json({ error: refined.detail || "proposal refinement failed" }, response.status >= 400 ? response.status as 400 : 502);
  }
  return c.json(await prisma.knowledgeProposal.update({
    where: { id: proposal.id },
    data: {
      afterContent: refined.after_content.slice(0, 200_000),
      rationale: refined.rationale?.trim().slice(0, 10_000) || proposal.rationale,
      decision: "pending",
    },
  }));
});

app.post("/consolidations/:id/apply", async (c) => {
  const body = await c.req.json<{ confirmedCurator?: boolean }>();
  if (!body.confirmedCurator) return c.json({ error: "explicit Curator confirmation is required" }, 403);
  const run = await prisma.consolidationRun.findUnique({
    where: { id: c.req.param("id") },
    include: { proposals: { orderBy: { createdAt: "asc" } } },
  });
  if (!run || run.resolvedAt) return c.json({ error: "active review not found" }, 404);
  const accepted = run.proposals.filter((proposal) =>
    proposal.decision === "accepted" && ["pending", "failed"].includes(proposal.applyStatus)
  );
  if (accepted.length === 0) return c.json({ error: "accept at least one pending proposal first" }, 409);
  await prisma.consolidationRun.update({ where: { id: run.id }, data: { status: "applying" } });
  const response = await memoryFetch("/vault/changes/apply-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      confirmed: true,
      changes: accepted.map((proposal) => ({
        id: proposal.id,
        kind: proposal.kind,
        target_path: proposal.targetPath,
        before_hash: proposal.beforeHash,
        after_content: proposal.afterContent,
        source_paths: Array.isArray(proposal.sourcePaths) ? proposal.sourcePaths : [],
      })),
    }),
  });
  const result = await response.json().catch(() => ({})) as {
    detail?: string;
    items?: Array<{ id: string; status: "synced" | "applied_pending_sync" }>;
  };
  if (!response.ok || !result.items) {
    const stale = response.status === 409;
    await prisma.$transaction(async (tx) => {
      await tx.consolidationRun.update({ where: { id: run.id }, data: { status: stale ? "stale" : "failed" } });
      await tx.knowledgeProposal.updateMany({
        where: { id: { in: accepted.map((proposal) => proposal.id) } },
        data: { applyStatus: stale ? "stale" : "failed" },
      });
    });
    return c.json({ error: result.detail || "batch application failed" }, stale ? 409 : 502);
  }
  const statusById = new Map(result.items.map((item) => [item.id, item.status]));
  await prisma.$transaction(async (tx) => {
    for (const proposal of accepted) {
      const applyStatus = statusById.get(proposal.id) || "applied_pending_sync";
      await tx.knowledgeProposal.update({ where: { id: proposal.id }, data: { applyStatus } });
      await tx.noteChange.create({
        data: {
          conversationId: run.conversationId,
          kind: proposal.kind === "create" || (proposal.kind === "merge" && !proposal.beforeContent)
            ? "created"
            : proposal.kind === "delete" ? "deleted" : "modified",
          noteTitle: path.posix.basename(proposal.targetPath, ".md"),
          notePath: proposal.targetPath,
          beforeContent: proposal.beforeContent,
          afterContent: proposal.afterContent,
          addedLines: Math.max(0, proposal.afterContent.split("\n").length - proposal.beforeContent.split("\n").length),
          removedLines: Math.max(0, proposal.beforeContent.split("\n").length - proposal.afterContent.split("\n").length),
        },
      });
      if (proposal.kind === "move" || proposal.kind === "merge") {
        const sourceSnapshots = Array.isArray(proposal.sourcePaths) ? proposal.sourcePaths : [];
        for (const raw of sourceSnapshots) {
          const snapshot = jsonRecord(raw);
          const sourcePath = optionalString(snapshot?.path);
          const sourceContent = optionalString(snapshot?.content) ?? "";
          if (!sourcePath || sourcePath === proposal.targetPath) continue;
          await tx.noteChange.create({
            data: {
              conversationId: run.conversationId,
              kind: "deleted",
              noteTitle: path.posix.basename(sourcePath, ".md"),
              notePath: sourcePath,
              beforeContent: sourceContent,
              afterContent: "",
              addedLines: 0,
              removedLines: sourceContent.split("\n").filter(Boolean).length,
            },
          });
        }
      }
    }
  });
  const unresolved = await prisma.knowledgeProposal.count({
    where: { consolidationId: run.id, decision: "pending" },
  });
  const resolvedAt = unresolved === 0 ? new Date() : null;
  await prisma.$transaction(async (tx) => {
    await tx.consolidationRun.update({
      where: { id: run.id },
      data: { status: resolvedAt ? "applied" : "draft", resolvedAt },
    });
    if (resolvedAt) {
      await tx.conversation.update({
        where: { id: run.conversationId },
        data: {
          lastConsolidatedMessageId: run.throughMessageId,
          consolidatedAt: resolvedAt,
          consolidationStatus: "consolidated",
        },
      });
    }
  });
  return c.json(await prisma.consolidationRun.findUnique({
    where: { id: run.id },
    include: { proposals: { orderBy: { createdAt: "asc" } } },
  }));
});

app.post("/consolidations/:id/retry-sync", async (c) => {
  const run = await prisma.consolidationRun.findUnique({
    where: { id: c.req.param("id") },
    include: { proposals: true },
  });
  if (!run) return c.json({ error: "review not found" }, 404);
  const waiting = run.proposals.filter((proposal) => proposal.applyStatus === "applied_pending_sync");
  let synced = 0;
  const { tenantId } = tenantContext();
  for (const proposal of waiting) {
    const target = await prisma.vaultDocument.findUnique({
      where: { tenantId_path: { tenantId, path: proposal.targetPath } },
    });
    const sourceSnapshots = Array.isArray(proposal.sourcePaths) ? proposal.sourcePaths : [];
    const removedPaths = sourceSnapshots.flatMap((raw) => {
      const snapshot = jsonRecord(raw);
      const sourcePath = optionalString(snapshot?.path);
      return sourcePath && (sourcePath !== proposal.targetPath || proposal.kind === "delete") ? [sourcePath] : [];
    });
    const remainingSources = removedPaths.length > 0
      ? await prisma.vaultDocument.count({ where: { path: { in: removedPaths } } })
      : 0;
    if (proposalSyncComplete(proposal.kind, target?.contentHash ?? null, sha256(proposal.afterContent), remainingSources)) {
      await prisma.knowledgeProposal.update({ where: { id: proposal.id }, data: { applyStatus: "synced" } });
      synced += 1;
    }
  }
  return c.json({ ok: true, checked: waiting.length, synced, waiting: waiting.length - synced });
});

app.post("/consolidations/:id/reject", async (c) => {
  const run = await prisma.consolidationRun.findUnique({ where: { id: c.req.param("id") } });
  if (!run) return c.json({ error: "review not found" }, 404);
  if (run.resolvedAt) return c.json({ error: "review is already resolved" }, 409);
  const resolvedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.consolidationRun.update({
      where: { id: run.id },
      data: { status: "rejected", resolvedAt },
    });
    await tx.knowledgeProposal.updateMany({
      where: { consolidationId: run.id, decision: "pending" },
      data: { decision: "rejected" },
    });
    await tx.conversation.update({
      where: { id: run.conversationId },
      data: {
        lastConsolidatedMessageId: run.throughMessageId,
        consolidatedAt: resolvedAt,
        consolidationStatus: "consolidated",
      },
    });
  });
  return c.json({ ok: true, status: "rejected" });
});

// Rename and/or move to a folder (folderId: null = loose, top level).
app.patch("/conversations/:id", async (c) => {
  const body = await c.req.json<{ title?: string; folderId?: string | null; mode?: ConversationMode }>();
  const data: Prisma.ConversationUpdateInput = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.folderId !== undefined) {
    data.folder = body.folderId ? { connect: { id: body.folderId } } : { disconnect: true };
  }
  if (body.mode !== undefined) data.mode = conversationMode(body.mode);
  const convo = await prisma.conversation.update({ where: { id: c.req.param("id") }, data });
  return c.json(convo);
});

app.post("/conversations/:id/archive", async (c) => {
  const convo = await prisma.conversation.update({
    where: { id: c.req.param("id") },
    data: { archivedAt: new Date() },
  });
  return c.json(convo);
});

app.post("/conversations/:id/unarchive", async (c) => {
  const convo = await prisma.conversation.update({
    where: { id: c.req.param("id") },
    data: { archivedAt: null },
  });
  return c.json(convo);
});

app.delete("/conversations/:id", async (c) => {
  const id = c.req.param("id");
  await prisma.$transaction(async (tx) => {
    await tx.captureJob.updateMany({ where: { conversationId: id }, data: { conversationId: null } });
    await tx.conversation.delete({ where: { id } });
  });
  await forgetConversationMemory(id);
  return c.json({ ok: true });
});

// ---------- Ask (persist + proxy stream to the Python memory engine) ----------

app.post("/conversations/:id/ask", async (c) => {
  const id = c.req.param("id");
  const { question, displayQuestion, mentions, attachments, regenerateMessageId, continuationToken, localToolResults, toolCycle, continuationUserMessageId, continuationAssistantMessageId } = await c.req.json<{
    question: string;
    displayQuestion?: string;
    mentions?: string[];
    attachments?: Array<{ name: string; type?: string; size?: number; content: string }>;
    regenerateMessageId?: string;
    continuationToken?: string;
    localToolResults?: Array<{ id: string; result: Record<string, unknown> }>;
    toolCycle?: number;
    continuationUserMessageId?: string;
    continuationAssistantMessageId?: string;
  }>();

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    select: {
      mode: true,
      claudeSessionId: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          role: true,
          text: true,
          sources: true,
          createdAt: true,
          _count: { select: { noteChanges: true, vaultDrafts: true } },
        },
      },
    },
  });
  if (!conversation) return c.json({ error: "not found" }, 404);
  const mode = conversationMode(conversation.mode);
  const chronologicalMessages = [...conversation.messages].reverse();
  const regeneration = regenerateMessageId
    ? selectRegenerationContext(chronologicalMessages, regenerateMessageId)
    : null;
  if (regenerateMessageId && !regeneration) {
    return c.json({ error: "Only the latest assistant response can be regenerated." }, 409);
  }
  if (regeneration && (
    regeneration.assistantMessage._count.noteChanges > 0
    || regeneration.assistantMessage._count.vaultDrafts > 0
  )) {
    return c.json({ error: "This response already has vault changes and cannot be regenerated safely." }, 409);
  }

  const isContinuation = Boolean(continuationToken);
  const userMessageId = isContinuation && continuationUserMessageId
    ? continuationUserMessageId
    : regeneration?.userMessage.id ?? randomUUID();
  const userMessage = isContinuation
    ? await prisma.message.findUniqueOrThrow({ where: { id: userMessageId } })
    : regeneration?.userMessage ?? await prisma.message.create({
    data: {
      id: userMessageId,
      conversationId: id,
      role: "user",
      text: displayQuestion || question,
      sources: [messageProvenance("user", userMessageId)] as Prisma.InputJsonValue,
    },
  });
  const assistantMessageId = isContinuation && continuationAssistantMessageId
    ? continuationAssistantMessageId
    : regeneration?.assistantMessage.id ?? randomUUID();
  const historyMessages = regeneration?.history ?? chronologicalMessages;

  if (!regeneration && requestsSavingLastAnswer(question)) {
    const target = conversation.messages.find((message) => message.role === "brain");
    const draft = target ? await createVaultDraft(target.id) : null;
    const answer = draft
      ? "I prepared a vault draft from my last answer. Review and edit it before applying the change."
      : "I couldn't find a previous assistant answer to save yet.";
    await prisma.message.create({
      data: {
        id: assistantMessageId,
        conversationId: id,
        role: "brain",
        text: answer,
        sources: [messageProvenance("brain", assistantMessageId)] as Prisma.InputJsonValue,
      },
    });
    await prisma.conversation.update({ where: { id }, data: { updatedAt: new Date(), consolidationStatus: "active" } });
    c.header("Content-Type", "text/event-stream");
    return stream(c, async (s) => {
      await s.write(sse("message_ids", { userMessageId: userMessage.id, assistantMessageId }));
      await s.write(sse("token", answer));
      if (draft) await s.write(sse("vault_draft", { ...draft, sourceMessageId: target?.id }));
    });
  }

  const upstream = await memoryFetch("/ask/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      message_id: userMessage.id,
      history: historyMessages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        created_at: message.createdAt.toISOString(),
        sources: normalizeKnowledgeSources(message.sources),
      })),
      mentions: mentions ?? [],
      attachments: (attachments ?? []).slice(0, 5).map((attachment) => ({
        name: String(attachment.name || "attachment").slice(0, 180),
        type: String(attachment.type || "text/plain").slice(0, 100),
        content: String(attachment.content || "").slice(0, 200_000),
      })),
      mode,
      claude_session_id: regeneration ? null : conversation.claudeSessionId,
      local_tool_results: localToolResults ?? [],
      continuation_token: continuationToken ?? null,
      tool_cycle: toolCycle ?? 0,
    }),
  });

  c.header("Content-Type", "text/event-stream");
  return stream(c, async (s) => {
    await s.write(sse("message_ids", {
      userMessageId: userMessage.id,
      assistantMessageId,
    }));
    if (!upstream.ok || !upstream.body) {
      const raw = (await upstream.json().catch(() => ({}))) as {
        detail?: ProviderErrorPayload | string;
        error?: string;
      };
      const detail = typeof raw.detail === "object" && raw.detail ? raw.detail : undefined;
      const error: ProviderErrorPayload = detail ?? {
        code: "memory_service_error",
        title: "Memory service error",
        message: typeof raw.detail === "string" ? raw.detail : raw.error || upstream.statusText,
        retryable: true,
      };
      const answer = providerErrorText(error);
      await s.write(sse("error", error));
      if (regeneration) {
        await prisma.message.update({
          where: { id: assistantMessageId },
          data: {
            text: answer,
            facts: Prisma.DbNull,
            sources: [messageProvenance("brain", assistantMessageId)] as Prisma.InputJsonValue,
          },
        });
      } else {
        await prisma.message.create({
          data: {
            id: assistantMessageId,
            conversationId: id,
            role: "brain",
            text: answer,
            sources: [messageProvenance("brain", assistantMessageId)] as Prisma.InputJsonValue,
          },
        });
      }
      await prisma.conversation.update({ where: { id }, data: { updatedAt: new Date(), consolidationStatus: "active" } });
      return;
    }

    const reader = upstream.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let answer = "";
    let facts: Prisma.InputJsonValue | undefined;
    let responseSources: KnowledgeSource[] = [];
    let actions: Prisma.InputJsonValue | undefined;
    let noteChanges: NoteChangePayload[] = [];
    let claudeSessionId: string | undefined;

    try {
      while (true) {
        let chunkRes;
        try {
          chunkRes = await reader.read(); // upstream may close the socket at end
        } catch {
          break;
        }
        if (chunkRes.done) break;
        const chunk = dec.decode(chunkRes.value, { stream: true });
        try {
          await s.write(chunk); // forward raw SSE (client may have left)
        } catch {
          /* client gone — keep reading so we can still persist the answer */
        }
        buf += chunk;
        const blocks = buf.split("\n\n");
        buf = blocks.pop() ?? "";
        for (const b of blocks) {
          const ev = b.match(/^event: (.*)$/m)?.[1];
          const data = b.match(/^data: ([\s\S]*)$/m)?.[1] ?? "";
          if (ev === "token") answer += JSON.parse(data);
          else if (ev === "facts") facts = JSON.parse(data);
          else if (ev === "sources") responseSources = normalizeKnowledgeSources(JSON.parse(data));
          else if (ev === "actions") actions = JSON.parse(data) as Prisma.InputJsonValue;
          else if (ev === "tool_request") {
            const payload = JSON.parse(data) as {
              requests?: Array<{ id: string; name: string; arguments?: Record<string, unknown> }>;
              actions?: Prisma.JsonValue;
            };
            const pendingActions = (payload.requests ?? []).map((request) => ({
              type: "tool_call",
              name: request.name,
              label: request.name === "web_fetch" ? "Lecture des pages" : "Recherche web",
              status: "pending",
              input: request.arguments ?? {},
              summary: "En cours…",
            }));
            const completedActions = Array.isArray(payload.actions) ? payload.actions : [];
            const requestedActions = [...completedActions, ...pendingActions];
            if (requestedActions.length > 0) {
              await prisma.message.upsert({
                where: { id: assistantMessageId },
                create: {
                  id: assistantMessageId,
                  conversationId: id,
                  role: "brain",
                  text: "",
                  sources: [messageProvenance("brain", assistantMessageId)] as Prisma.InputJsonValue,
                  actions: requestedActions as Prisma.InputJsonValue,
                },
                update: { actions: requestedActions as Prisma.InputJsonValue },
              });
            }
          }
          else if (ev === "changes") noteChanges = JSON.parse(data) as NoteChangePayload[];
          else if (ev === "provider_session") {
            const providerSession = JSON.parse(data) as { id?: unknown };
            if (typeof providerSession.id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(providerSession.id)) {
              claudeSessionId = providerSession.id;
            }
          }
          else if (ev === "error") {
            const parsedError = JSON.parse(data) as ProviderErrorPayload;
            answer = providerErrorText(parsedError);
          }
        }
      }
    } finally {
      // Persist whatever we got, on any exit path.
      if (answer) {
        if (responseSources.length === 0) responseSources = knowledgeSourcesFromFacts(facts);
        responseSources = normalizeKnowledgeSources([
          messageProvenance("brain", assistantMessageId),
          ...responseSources,
        ]);
        const previousMessage = await prisma.message.findUnique({
          where: { id: assistantMessageId },
          select: { actions: true },
        });
        const previousActions = Array.isArray(previousMessage?.actions) ? previousMessage.actions : [];
        const currentActions = Array.isArray(actions) ? actions : [];
        const actionKey = (value: unknown) => {
          const record = jsonRecord(value);
          return record ? `${String(record.name || "")}:${JSON.stringify(record.input || {})}` : "";
        };
        const persistedActions = [...previousActions];
        for (const action of currentActions) {
          const key = actionKey(action);
          const index = key ? persistedActions.findIndex((item) => actionKey(item) === key) : -1;
          if (index >= 0) persistedActions[index] = action;
          else persistedActions.push(action);
        }
        const message = await prisma.message.upsert({
          where: { id: assistantMessageId },
          create: {
            id: assistantMessageId,
            conversationId: id,
            role: "brain",
            text: answer,
            facts,
            sources: responseSources as Prisma.InputJsonValue,
            actions: persistedActions.length > 0 ? persistedActions as Prisma.InputJsonValue : Prisma.DbNull,
          },
          update: {
            text: answer,
            facts: facts ?? Prisma.DbNull,
            sources: responseSources as Prisma.InputJsonValue,
            actions: persistedActions.length > 0 ? persistedActions as Prisma.InputJsonValue : Prisma.DbNull,
          },
        });
        if (noteChanges.length > 0) {
          await prisma.noteChange.createMany({
            data: noteChanges.map((change) => ({
              conversationId: id,
              messageId: message.id,
              kind: change.kind,
              noteTitle: change.noteTitle,
              notePath: change.notePath,
              beforeContent: change.beforeContent ?? "",
              afterContent: change.afterContent ?? "",
              addedLines: change.addedLines ?? 0,
              removedLines: change.removedLines ?? 0,
            })),
          });
        }
        await prisma.conversation.update({
          where: { id },
          data: {
            updatedAt: new Date(),
            consolidationStatus: "active",
            ...(claudeSessionId ? { claudeSessionId } : {}),
          },
        });
      }
    }
  });
});

// ---------- Capture URL jobs (proxy to memory, optionally persist in a conversation) ----------
app.post("/capture", async (c) => {
  const body = await c.req.json<{
    url: string;
    instruction?: string;
    summaryDegree?: number;
    destinationFolder?: string;
    conversationId?: string;
    message?: string;
  }>();
  const url = body.url?.trim() ?? "";
  if (!url) return c.json({ error: "url is required" }, 400);
  const job = await createCaptureJob({
    url,
    instruction: body.instruction,
    summaryDegree: body.summaryDegree,
    destinationFolder: body.destinationFolder,
    conversationId: body.conversationId,
    message: body.message,
  });
  void runCaptureJob(job.id).catch((err) => {
    console.error(`[capture] job ${job.id} failed`, err);
  });
  c.status(202);
  return c.json(captureJobResponse(job));
});

app.get("/capture/jobs/:id", async (c) => {
  const job = await prisma.captureJob.findUnique({ where: { id: c.req.param("id") } });
  if (!job) return c.json({ error: "not found" }, 404);
  return c.json(captureJobResponse(job));
});

app.get("/capture/folders", async (c) => {
  const res = await memoryFetch("/capture/folders");
  c.status(res.ok ? 200 : 502);
  return c.json(await res.json().catch(() => ({ items: ["1. INBOX"] })));
});

app.post("/capture/url", async (c) => {
  const body = await c.req.json<{
    url: string;
    instruction?: string;
    summaryDegree?: number;
    destinationFolder?: string;
    conversationId?: string;
    message?: string;
  }>();
  const url = body.url?.trim() ?? "";
  const instruction = body.instruction?.trim() ?? "";
  const message = body.message?.trim() || `/capture ${url}${instruction ? ` ${instruction}` : ""}`;
  const conversationId = body.conversationId?.trim() ?? "";
  if (!url) return c.json({ ok: false, error: "url is required", answer: "Capture failed: url is required" }, 400);

  const job = await createCaptureJob({
    url,
    instruction,
    summaryDegree: body.summaryDegree,
    destinationFolder: body.destinationFolder,
    conversationId,
    message,
  });
  const finished = await runCaptureJob(job.id);
  if (!finished || finished.status === "failed") {
    c.status(400);
  }
  return c.json(captureJobResponse(finished ?? job));
});

// ---------- Derived vault chunk index ----------
app.get("/rag/documents/hash", async (c) => {
  const notePath = (c.req.query("path") ?? "").trim();
  if (!notePath) return c.json({ error: "path is required" }, 400);
  const { tenantId } = tenantContext();
  const document = await prisma.vaultDocument.findUnique({
    where: { tenantId_path: { tenantId, path: notePath } },
    select: {
      contentHash: true,
      embeddingModel: true,
      metadata: true,
      chunks: { select: { id: true, contentHash: true } },
    },
  });
  const metadata = document?.metadata && typeof document.metadata === "object" && !Array.isArray(document.metadata)
    ? document.metadata as Record<string, unknown>
    : {};
  return c.json({
    contentHash: document?.contentHash ?? null,
    embeddingModel: document?.embeddingModel ?? null,
    searchTextVersion: typeof metadata.searchTextVersion === "string" ? metadata.searchTextVersion : null,
    chunks: document?.chunks ?? [],
  });
});

app.put("/rag/documents", async (c) => {
  const body = await c.req.json<{
    id: string;
    path: string;
    title: string;
    contentHash: string;
    embeddingModel: string;
    metadata?: unknown;
    chunks: RagChunkInput[];
  }>();
  const documentId = body.id?.trim();
  const notePath = body.path?.trim();
  const title = body.title?.trim();
  const contentHash = body.contentHash?.trim();
  const embeddingModel = body.embeddingModel?.trim();
  if (!documentId || !notePath || !title || !contentHash || !embeddingModel) {
    return c.json({ error: "id, path, title, contentHash and embeddingModel are required" }, 400);
  }
  if (!MODEL_ID.test(embeddingModel) || embeddingModel.length > 180) {
    return c.json({ error: "embeddingModel is invalid" }, 400);
  }
  if (!Array.isArray(body.chunks) || body.chunks.length > 500) {
    return c.json({ error: "chunks must contain at most 500 items" }, 400);
  }

  const chunks = body.chunks.map((chunk) => ({
    ...chunk,
    vector: chunk.embedding === undefined ? null : vectorLiteral(chunk.embedding),
  }));
  if (chunks.some((chunk) => !chunk.id?.trim() || !chunk.contentHash?.trim())) {
    return c.json({ error: "every chunk requires an id and content hash" }, 400);
  }
  if (chunks.some((chunk) => chunk.embedding !== undefined && !chunk.vector)) {
    return c.json({ error: "provided embeddings must contain 1024 dimensions" }, 400);
  }
  if (chunks.some((chunk) => !chunk.text?.trim() || chunk.text.length > 20_000)) {
    return c.json({ error: "chunk text must contain between 1 and 20000 characters" }, 400);
  }

  const { tenantId } = tenantContext();
  await prisma.$transaction(async (tx) => {
    const document = await tx.vaultDocument.upsert({
      where: { tenantId_path: { tenantId, path: notePath } },
      create: {
        id: documentId,
        tenantId,
        path: notePath,
        title,
        contentHash,
        embeddingModel,
        metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
      },
      update: {
        title,
        contentHash,
        embeddingModel,
        metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
    const incomingIds = chunks.map((chunk) => chunk.id);
    await tx.vaultChunk.deleteMany({
      where: { documentId: document.id, id: { notIn: incomingIds } },
    });
    for (const chunk of chunks) {
      if (!chunk.vector) {
        const unchanged = await tx.vaultChunk.findFirst({
          where: { id: chunk.id, documentId: document.id, contentHash: chunk.contentHash },
          select: { id: true },
        });
        if (!unchanged) throw new Error(`embedding missing for changed chunk ${chunk.id}`);
        continue;
      }
      await tx.$executeRaw`
        INSERT INTO "VaultChunk"
          (id, "tenantId", "documentId", "headingPath", "startLine", "endLine", text, "contentHash", embedding)
        VALUES
          (${chunk.id}, ${tenantId}, ${document.id}, ${chunk.headingPath || ""}, ${chunk.startLine}, ${chunk.endLine},
           ${chunk.text}, ${chunk.contentHash}, ${chunk.vector}::vector)
        ON CONFLICT ("tenantId", id) DO UPDATE SET
          "documentId" = EXCLUDED."documentId",
          "headingPath" = EXCLUDED."headingPath",
          "startLine" = EXCLUDED."startLine",
          "endLine" = EXCLUDED."endLine",
          text = EXCLUDED.text,
          "contentHash" = EXCLUDED."contentHash",
          embedding = EXCLUDED.embedding
      `;
    }
  });
  return c.json({ ok: true, path: notePath, chunks: chunks.length });
});

app.delete("/rag/documents", async (c) => {
  const notePath = (c.req.query("path") ?? "").trim();
  if (!notePath) return c.json({ error: "path is required" }, 400);
  const deleted = await prisma.vaultDocument.deleteMany({ where: { path: notePath } });
  return c.json({ ok: true, deleted: deleted.count });
});

// ---------- Locally-produced ingestion artifacts ----------
async function persistArtifactChunks(artifact: IngestionArtifactV1) {
  const { tenantId } = tenantContext();
  const documentId = createHash("sha256").update(`local-document\0${artifact.note.path}`).digest("hex");
  await prisma.$transaction(async (tx) => {
    const document = await tx.vaultDocument.upsert({
      where: { tenantId_path: { tenantId, path: artifact.note.path } },
      create: {
        id: documentId,
        tenantId,
        path: artifact.note.path,
        title: artifact.note.title,
        contentHash: artifact.note.contentHash,
        embeddingModel: artifact.embeddingModel,
        metadata: prismaJson({
          source: "claude-code-local",
          artifactId: artifact.artifactId,
          pipelineSignature: artifact.pipelineSignature,
          chunkerVersion: artifact.chunkerVersion,
        }),
      },
      update: {
        title: artifact.note.title,
        contentHash: artifact.note.contentHash,
        embeddingModel: artifact.embeddingModel,
        metadata: prismaJson({
          source: "claude-code-local",
          artifactId: artifact.artifactId,
          pipelineSignature: artifact.pipelineSignature,
          chunkerVersion: artifact.chunkerVersion,
        }),
      },
    });
    await tx.vaultChunk.deleteMany({ where: { documentId: document.id } });
    for (const chunk of artifact.chunks) {
      const vector = vectorLiteral(chunk.embedding);
      if (!vector) throw new Error(`invalid embedding for chunk ${chunk.id}`);
      await tx.$executeRaw`
        INSERT INTO "VaultChunk"
          (id, "tenantId", "documentId", "headingPath", "startLine", "endLine", text, "contentHash", embedding)
        VALUES
          (${chunk.id}, ${tenantId}, ${document.id}, ${chunk.headingPath}, ${chunk.startLine}, ${chunk.endLine},
           ${chunk.text}, ${chunk.contentHash}, ${vector}::vector)
      `;
    }
  });
}

async function applyIngestionArtifact(id: string, payload: Prisma.JsonValue) {
  const { tenantId } = tenantContext();
  const artifact = parseIngestionArtifact(payload);
  await prisma.ingestionArtifact.update({
    where: { tenantId_id: { tenantId, id } },
    data: { status: "processing", error: Prisma.DbNull },
  });
  try {
    const response = await memoryFetch("/ingest/artifact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`memory service rejected artifact with ${response.status}`);
    await persistArtifactChunks(artifact);
    await prisma.ingestionArtifact.update({
      where: { tenantId_id: { tenantId, id } },
      data: { status: "applied", error: Prisma.DbNull, appliedAt: new Date() },
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "artifact application failed";
    await prisma.ingestionArtifact.update({
      where: { tenantId_id: { tenantId, id } },
      data: { status: "failed", error: prismaJson({ message }) },
    });
    throw error;
  }
}

app.post("/ingest/artifacts/preflight", async (c) => {
  let body;
  try {
    body = parseArtifactPreflight(await c.req.json());
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "invalid preflight payload" }, 400);
  }
  const { tenantId } = tenantContext();
  const existing = await prisma.ingestionArtifact.findUnique({
    where: {
      tenantId_path_contentHash_pipelineSignature: {
        tenantId,
        path: body.path,
        contentHash: body.contentHash,
        pipelineSignature: body.pipelineSignature,
      },
    },
    select: { id: true, status: true, payload: true },
  });
  if (!existing) return c.json({ action: "extract" });
  if (existing.status !== "applied") {
    try {
      await applyIngestionArtifact(existing.id, existing.payload);
      existing.status = "applied";
    } catch {
      return c.json({ error: "stored artifact could not be applied" }, 502);
    }
  }
  return c.json({ action: "already_received", artifactId: existing.id, status: existing.status });
});

app.post("/ingest/artifacts", async (c) => {
  let artifact;
  try {
    artifact = parseIngestionArtifact(await c.req.json());
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "invalid ingestion artifact" }, 400);
  }
  const { tenantId } = tenantContext();
  const stored = await prisma.ingestionArtifact.upsert({
    where: {
      tenantId_path_contentHash_pipelineSignature: {
        tenantId,
        path: artifact.note.path,
        contentHash: artifact.note.contentHash,
        pipelineSignature: artifact.pipelineSignature,
      },
    },
    create: {
      id: artifact.artifactId,
      tenantId,
      path: artifact.note.path,
      contentHash: artifact.note.contentHash,
      pipelineSignature: artifact.pipelineSignature,
      provider: artifact.provider,
      payload: prismaJson(artifact),
    },
    update: {},
    select: { id: true, payload: true },
  });
  try {
    const result = await applyIngestionArtifact(stored.id, stored.payload);
    return c.json({ ok: true, artifactId: stored.id, status: "applied", result });
  } catch {
    return c.json({ error: "artifact was stored but could not be applied", artifactId: stored.id }, 502);
  }
});

app.post("/ingest/note", async (c) => {
  const note = await c.req.json().catch(() => null);
  if (!note || typeof note !== "object" || Array.isArray(note)) {
    return c.json({ error: "a note payload is required" }, 400);
  }
  const notePayload = note as Record<string, unknown>;
  if (typeof notePayload.title !== "string" || typeof notePayload.body !== "string") {
    return c.json({ error: "note title and body are required" }, 400);
  }
  const stablePath = typeof notePayload.path === "string" ? notePayload.path : notePayload.title;
  const requestKey = noteIngestionRequestKey(stablePath, notePayload.body);
  const { tenantId } = tenantContext();
  let job = await prisma.noteIngestionJob.upsert({
    where: { tenantId_requestKey: { tenantId, requestKey } },
    create: { requestKey, note: prismaJson(note) },
    update: {},
  });
  if (job.status === "failed") {
    job = await prisma.noteIngestionJob.update({
      where: { id: job.id },
      data: {
        status: "queued",
        note: prismaJson(note),
        result: Prisma.DbNull,
        error: Prisma.DbNull,
        startedAt: null,
        finishedAt: null,
      },
    });
  }
  scheduleNoteIngestionJob(job.id, tenantContext());
  c.status(202);
  return c.json(noteIngestionJobResponse(job));
});

app.get("/ingest/jobs/:id", async (c) => {
  const job = await prisma.noteIngestionJob.findUnique({ where: { id: c.req.param("id") } });
  if (!job) return c.json({ error: "not found" }, 404);
  return c.json(noteIngestionJobResponse(job));
});

app.delete("/note", async (c) => {
  const notePath = c.req.query("path") ?? "";
  const { tenantId } = tenantContext();
  const settings = await prisma.settings.findUnique({
    where: { tenantId },
    select: { ingestionProvider: true },
  });
  if (settings?.ingestionProvider === "claude-code") {
    const query = new URLSearchParams({ path: notePath });
    const response = await memoryFetch(`/ingest/artifact?${query}`, { method: "DELETE" });
    if (!response.ok) return c.json({ error: "local graph deletion failed" }, 502);
    const [artifacts, documents] = await prisma.$transaction([
      prisma.ingestionArtifact.deleteMany({ where: { path: notePath } }),
      prisma.vaultDocument.deleteMany({ where: { path: notePath } }),
    ]);
    return c.json({ ok: true, deleted: notePath, artifacts: artifacts.count, documents: documents.count });
  }
  const query = new URLSearchParams({
    path: notePath,
    title: c.req.query("title") ?? "",
  });
  const response = await memoryFetch(`/note?${query}`, { method: "DELETE" });
  return c.json(await response.json(), response.ok ? 200 : 502);
});

app.get("/vault/manifest", async (c) => {
  const { tenantId } = tenantContext();
  const settings = await prisma.settings.findUnique({
    where: { tenantId },
    select: {
      ingestionProvider: true,
      claudeIngestionModel: true,
      claudeEmbeddingModel: true,
    },
  });
  if (settings?.ingestionProvider === "claude-code") {
    const embeddingModel = localEmbeddingModel(settings.claudeEmbeddingModel);
    const pipelineSignature = currentClaudePipelineSignature(
      settings.claudeIngestionModel,
      settings.claudeEmbeddingModel,
    );
    const documents = await prisma.vaultDocument.findMany({
      where: { embeddingModel },
      orderBy: { path: "asc" },
      select: { title: true, path: true, contentHash: true, metadata: true },
    });
    return c.json({
      items: documents.map((document) => {
        const metadata = document.metadata && typeof document.metadata === "object" && !Array.isArray(document.metadata)
          ? document.metadata as Record<string, unknown>
          : {};
        return {
          title: document.title,
          path: document.path,
          content_hash: metadata.pipelineSignature === pipelineSignature ? document.contentHash : "",
        };
      }),
    });
  }
  const response = await memoryFetch("/vault/manifest");
  return c.json(await response.json(), response.ok ? 200 : 502);
});

app.post("/rag/search", async (c) => {
  const body = await c.req.json<{ query: string; embedding: number[]; limit?: number }>();
  const query = body.query?.trim();
  const vector = vectorLiteral(body.embedding);
  const limit = Math.max(1, Math.min(Number(body.limit ?? 12), 30));
  if (!query || !vector) return c.json({ error: "query and a 1024-dimensional embedding are required" }, 400);
  const { tenantId } = tenantContext();
  const settings = await prisma.settings.findUnique({
    where: { tenantId },
    select: { embeddingModel: true, ingestionProvider: true, claudeEmbeddingModel: true },
  });
  const embeddingModel = settings?.ingestionProvider === "claude-code"
    ? localEmbeddingModel(settings.claudeEmbeddingModel)
    : settings?.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
  const candidateLimit = Math.min(Math.max(limit * 5, 40), 80);
  const broadenLexical = /\b[A-Z0-9]{2,}\b/.test(query);
  const fuzzyTokens = query.match(/\b[A-Z0-9]{3,}\b/g) ?? [];

  // Legacy path: linear mix of incompatible scores (rollback: RETRIEVAL_V2=0).
  if (!useRetrievalV2()) {
    const rows = await prisma.$queryRaw<RagSearchRow[]>`
      WITH candidates AS (
        SELECT
          c.id,
          c."documentId",
          d.path,
          d.title,
          c."headingPath",
          c."startLine",
          c."endLine",
          c.text,
          (1 - (c.embedding <=> ${vector}::vector))::double precision AS "semanticScore",
          ts_rank_cd(
            to_tsvector('simple', coalesce(d.title, '') || ' ' || coalesce(d.path, '') || ' ' || coalesce(c."headingPath", '') || ' ' || c.text),
            plainto_tsquery('simple', ${query})
          )::double precision AS "lexicalScore"
        FROM "VaultChunk" c
        JOIN "VaultDocument" d ON d."tenantId" = c."tenantId" AND d.id = c."documentId"
        WHERE c."tenantId" = ${tenantId} AND d."embeddingModel" = ${embeddingModel}
      )
      SELECT *,
        (("semanticScore" * 0.75) + (LEAST("lexicalScore", 1) * 0.25))::double precision AS score
      FROM candidates
      ORDER BY score DESC
      LIMIT ${limit}
    `;
    return c.json({ items: rows, ranking: "legacy_linear" });
  }

  // V2: independent channels → Weighted RRF → exact bonuses → quality soft-penalties → diversify.
  type ChannelRow = {
    id: string;
    documentId: string;
    path: string;
    title: string;
    headingPath: string;
    startLine: number;
    endLine: number;
    text: string;
    semanticScore: number;
    lexicalScore: number;
  };

  const [semanticRows, lexicalRows] = await Promise.all([
    prisma.$queryRaw<ChannelRow[]>`
      SELECT
        c.id,
        c."documentId",
        d.path,
        d.title,
        c."headingPath",
        c."startLine",
        c."endLine",
        c.text,
        (1 - (c.embedding <=> ${vector}::vector))::double precision AS "semanticScore",
        0::double precision AS "lexicalScore"
      FROM "VaultChunk" c
      JOIN "VaultDocument" d ON d."tenantId" = c."tenantId" AND d.id = c."documentId"
      WHERE c."tenantId" = ${tenantId} AND d."embeddingModel" = ${embeddingModel}
        AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> ${vector}::vector
      LIMIT ${candidateLimit}
    `,
    prisma.$queryRaw<ChannelRow[]>`
      WITH query_terms AS (
        SELECT
          plainto_tsquery('simple', ${query}) AS exact_query,
          to_tsquery(
            'simple',
            regexp_replace(plainto_tsquery('simple', ${query})::text, ' & ', ' | ', 'g')
          ) AS broad_query
      ), exact_matches AS (
        SELECT 1
        FROM "VaultChunk" exact_chunk
        JOIN "VaultDocument" exact_document
          ON exact_document."tenantId" = exact_chunk."tenantId"
         AND exact_document.id = exact_chunk."documentId"
        CROSS JOIN query_terms exact_terms
        WHERE exact_chunk."tenantId" = ${tenantId}
          AND exact_document."embeddingModel" = ${embeddingModel}
          AND to_tsvector(
            'simple',
            coalesce(exact_document.title, '') || ' ' || coalesce(exact_document.path, '') || ' ' ||
            coalesce(exact_chunk."headingPath", '') || ' ' || exact_chunk.text
          ) @@ exact_terms.exact_query
        LIMIT 1
      )
      SELECT
        c.id,
        c."documentId",
        d.path,
        d.title,
        c."headingPath",
        c."startLine",
        c."endLine",
        c.text,
        0::double precision AS "semanticScore",
        (
          ts_rank_cd(
            to_tsvector('simple', coalesce(d.title, '') || ' ' || coalesce(d.path, '') || ' ' || coalesce(c."headingPath", '') || ' ' || c.text),
            query_terms.exact_query
          ) +
          (0.2 * ts_rank_cd(
            to_tsvector('simple', coalesce(d.title, '') || ' ' || coalesce(d.path, '') || ' ' || coalesce(c."headingPath", '') || ' ' || c.text),
            query_terms.broad_query
          ))
          + CASE WHEN EXISTS (
            SELECT 1
            FROM unnest(${fuzzyTokens}::text[]) AS fuzzy(token)
            CROSS JOIN LATERAL regexp_split_to_table(
              upper(coalesce(d.title, '') || ' ' || coalesce(d.path, '') || ' ' ||
                coalesce(c."headingPath", '') || ' ' || c.text),
              '[^A-Z0-9]+'
            ) AS candidate(word)
            WHERE length(candidate.word) >= 3
              AND levenshtein(fuzzy.token, candidate.word) <= 1
          ) THEN 0.5 ELSE 0 END
        )::double precision AS "lexicalScore"
      FROM "VaultChunk" c
      JOIN "VaultDocument" d ON d."tenantId" = c."tenantId" AND d.id = c."documentId"
      CROSS JOIN query_terms
      WHERE c."tenantId" = ${tenantId} AND d."embeddingModel" = ${embeddingModel}
        AND (
          to_tsvector('simple', coalesce(d.title, '') || ' ' || coalesce(d.path, '') || ' ' || coalesce(c."headingPath", '') || ' ' || c.text)
              @@ query_terms.broad_query
          OR EXISTS (
            SELECT 1
            FROM unnest(${fuzzyTokens}::text[]) AS fuzzy(token)
            CROSS JOIN LATERAL regexp_split_to_table(
              upper(coalesce(d.title, '') || ' ' || coalesce(d.path, '') || ' ' ||
                coalesce(c."headingPath", '') || ' ' || c.text),
              '[^A-Z0-9]+'
            ) AS candidate(word)
            WHERE length(candidate.word) >= 3
              AND levenshtein(fuzzy.token, candidate.word) <= 1
          )
        )
        AND (
          to_tsvector('simple', coalesce(d.title, '') || ' ' || coalesce(d.path, '') || ' ' || coalesce(c."headingPath", '') || ' ' || c.text)
              @@ query_terms.exact_query
          OR ${broadenLexical}
          OR NOT EXISTS (SELECT 1 FROM exact_matches)
          OR EXISTS (
            SELECT 1
            FROM unnest(${fuzzyTokens}::text[]) AS fuzzy(token)
            CROSS JOIN LATERAL regexp_split_to_table(
              upper(coalesce(d.title, '') || ' ' || coalesce(d.path, '') || ' ' ||
                coalesce(c."headingPath", '') || ' ' || c.text),
              '[^A-Z0-9]+'
            ) AS candidate(word)
            WHERE length(candidate.word) >= 3
              AND levenshtein(fuzzy.token, candidate.word) <= 1
          )
        )
      ORDER BY "lexicalScore" DESC
      LIMIT ${candidateLimit}
    `,
  ]);

  const items = fuseRagCandidates({
    query,
    semantic: semanticRows.map((row) => ({ ...row, score: row.semanticScore })),
    lexical: lexicalRows.map((row) => ({ ...row, score: row.lexicalScore })),
    limit,
  });

  return c.json({
    items,
    ranking: "rrf_v2",
    channels: { semantic: semanticRows.length, lexical: lexicalRows.length },
  });
});

// ---------- Vault notes (autocomplete for @-mentions) ----------
app.get("/notes", async (c) => {
  const q = c.req.query("q") ?? "";
  const res = await memoryFetch(`/notes?q=${encodeURIComponent(q)}`);
  return c.json(await res.json());
});

app.get("/notes/tree", async (c) => {
  const q = c.req.query("q") ?? "";
  const res = await memoryFetch(`/vault/tree?q=${encodeURIComponent(q)}`);
  return c.json(await res.json(), res.ok ? 200 : 502);
});

app.get("/notes/content", async (c) => {
  const notePath = c.req.query("path") ?? "";
  const res = await memoryFetch(`/notes/content?path=${encodeURIComponent(notePath)}`);
  return c.json(await res.json(), res.ok ? 200 : res.status === 404 ? 404 : 502);
});

// ---------- Resurfacing (proxy) ----------
app.get("/resurface", async (c) => {
  const n = c.req.query("n") ?? "3";
  const res = await memoryFetch(`/resurface?n=${n}`);
  return c.json(await res.json());
});

app.post("/resurface/review", async (c) => {
  const res = await memoryFetch("/resurface/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(await c.req.json()),
  });
  return c.json(await res.json());
});

// Sweep expired archives at boot, then hourly.
sweepExpiredForAllTenants().catch(() => {});
recoverNoteIngestionJobs().catch((error) => console.error("[ingest] unable to recover queued jobs", error));
setInterval(() => sweepExpiredForAllTenants().catch(() => {}), 3_600_000);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port} → memory ${MEMORY}`);
});
