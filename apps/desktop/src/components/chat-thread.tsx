import { useEffect, useRef, useState, type WheelEvent as ReactWheelEvent } from "react";
import { useLingui as useLinguiReact } from "@lingui/react";
import { API_URL as API } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AnimatePresence } from "motion/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookMarked, Check, ChevronDown, Copy, ExternalLink, FilePlus2, FileText, MessageCircle, RotateCcw, Search, Sparkles, X } from "lucide-react";
import { createMarkdownComponents, citationToVaultNote, buildCitations, openExternalLink, markdownLabel } from "@/components/markdown-renderer";
import { ChangeDiffModal } from "@/components/change-diff-modal";
import { ObsidianMarkdown } from "@/components/obsidian-markdown";
import { SaveToVaultModal, type VaultDraft } from "@/components/save-to-vault-modal";
import { ConsolidationProgressModal, ConsolidationReviewModal, type ConsolidationRun } from "@/components/consolidation-review-modal";
import { ThinkingIndicator } from "@/components/thinking-indicator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ChatAttachment, ChatError, ComposerDraftState, ConversationMode, Folder, KnowledgeSource, MessageAction, Msg } from "@/App";
import type { VaultNote } from "@/components/vault-explorer";
import { Icon } from "@/App";
import { Composer } from "@/components/composer";

function messageTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return new Intl.DateTimeFormat(locale, sameDay ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function fullMessageTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function MessageTimestamp(props: { iso?: string; role: Msg["role"]; locale: string; inline?: boolean }) {
  if (!props.iso) return null;
  const label = messageTime(props.iso, props.locale);
  if (!label) return null;
  return (
    <div
      title={fullMessageTime(props.iso, props.locale)}
      className={cn(
        "text-[11px] leading-none tabular-nums",
        props.inline ? "ml-auto shrink-0 pl-3" : "absolute bottom-2 right-3",
        props.role === "user" ? "text-primary-foreground/65" : "text-muted-foreground",
      )}
    >
      {label}
    </div>
  );
}

export function ChatErrorPanel(props: { error: ChatError }) {
  const title = props.error.title || "AI provider unavailable";
  const message = props.error.message || "The AI provider rejected the request.";
  return (
    <div className="rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-[13px] leading-5">
      <div className="flex items-center gap-2 font-medium text-foreground">
        <Icon name="bolt-2" className="text-[15px] text-destructive" />
        <span>{title}</span>
      </div>
      <p className="mt-1 text-muted-foreground">{message}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
        {props.error.provider && <span>{props.error.provider}</span>}
        {props.error.actionUrl && (
          <button
            type="button"
            onClick={() => window.open(props.error.actionUrl, "_blank", "noreferrer")}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-1 text-foreground transition-colors hover:border-primary/50 hover:bg-accent"
          >
            <Icon name="open-in-new" className="text-[13px]" />
            <span>Open billing</span>
          </button>
        )}
      </div>
    </div>
  );
}

export function shouldSuggestVaultConsolidation(message: Msg | undefined) {
  if (!message || message.role !== "brain" || !message.text || message.error) return false;
  const hasVaultKnowledge = message.sources?.some((source) =>
    source.origin === "user_authored" || Boolean(source.notePath)
  ) || message.facts?.some((fact) => fact.source_type === "note" || Boolean(fact.note_path));
  const hasComplementaryKnowledge = message.sources?.some((source) =>
    source.origin === "assistant_synthesis"
    || source.origin === "external_source"
    || source.origin === "model_knowledge"
  );
  return Boolean(hasVaultKnowledge && hasComplementaryKnowledge);
}

export function ToolActivity(props: { action: Extract<MessageAction, { type: "tool_call" }>; sources?: KnowledgeSource[] }) {
  const { action } = props;
  const isError = action.status === "error";
  const query = typeof action.input?.query === "string" ? action.input.query : "";
  const urls = Array.isArray(action.input?.urls) ? action.input.urls : [];
  const detail = query ? `« ${query} »` : urls.length ? `${urls.length} URL${urls.length === 1 ? "" : "s"}` : "";
  const results = action.results?.length
    ? action.results
    : (props.sources ?? [])
      .filter((source) => source.origin === "external_source" && source.url)
      .map((source) => ({ title: source.title ?? undefined, url: source.url!, excerpt: source.excerpt }));
  return (
    <details className="group/tool border-l-2 border-primary/30 pl-3 text-[12px]">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-1.5 text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-md",
          isError ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
        )}>
          {action.name === "search_web" ? <Search className="size-3" /> : <ExternalLink className="size-3" />}
        </span>
        <span className="font-medium text-foreground/85">{action.label}</span>
        {detail && <span className="min-w-0 flex-1 truncate text-muted-foreground">{detail}</span>}
        {!detail && <span className="min-w-0 flex-1 truncate text-muted-foreground">{action.status === "pending" ? "En cours…" : action.summary}</span>}
        {action.status !== "pending" && (
          <span className={cn(
            "shrink-0 text-[10px] font-medium uppercase tracking-wide",
            isError ? "text-destructive" : "text-emerald-500",
          )}>{isError ? "Échec" : "Terminé"}</span>
        )}
        <ChevronDown className="size-3 transition-transform group-open/tool:rotate-180" />
      </summary>
      <div className="pb-2 pt-1">
        {results.length > 0 && (
          <div className="space-y-0.5">
            <div className="space-y-1.5">
              {results.map((result, index) => (
                <a
                  key={`${result.url}-${index}`}
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => {
                    event.preventDefault();
                    openExternalLink(result.url);
                  }}
                  className="block rounded-md px-2 py-1 text-primary transition-colors hover:bg-primary/10"
                >
                  <span className="block truncate text-[12px] font-medium">{result.title || result.url}</span>
                  {result.excerpt && <span className="block truncate text-[11px] text-muted-foreground">{result.excerpt}</span>}
                </a>
              ))}
            </div>
          </div>
        )}
        {!results.length && action.summary && <div className="pl-7 text-[11px] text-muted-foreground">{action.summary}</div>}
      </div>
    </details>
  );
}

export function Thread(props: {
  conversationId: string;
  messages: Msg[];
  busy: boolean;
  onSend: (q: string, m: string[], attachments?: ChatAttachment[]) => void;
  onRegenerate: (question: string, messageId: string) => void;
  onOpenNote: (note: VaultNote) => void;
  onPreviewConversation: (id: string) => void;
  onOpenConversation: (id: string) => void;
  onHome: () => void;
  folders: Folder[];
  projectId: string | null;
  onProjectChange: (folderId: string | null) => void;
  mode: ConversationMode;
  onModeChange: (mode: ConversationMode) => void;
  vaultPath: string;
  composerDraft: ComposerDraftState;
  onComposerDraftChange: (draft: ComposerDraftState) => void;
}) {
  const { i18n } = useLinguiReact();
  const endRef = useRef<HTMLDivElement>(null);
  const wheelSwipeRef = useRef<{ total: number; lastAt: number }>({ total: 0, lastAt: 0 });
  const [changesOpen, setChangesOpen] = useState(false);
  const [vaultDraft, setVaultDraft] = useState<VaultDraft | null>(null);
  const [draftOverrides, setDraftOverrides] = useState<Record<string, VaultDraft>>({});
  const [savingMessageId, setSavingMessageId] = useState<string | null>(null);
  const [consolidationRun, setConsolidationRun] = useState<ConsolidationRun | null>(null);
  const [consolidationModalOpen, setConsolidationModalOpen] = useState(false);
  const [consolidationError, setConsolidationError] = useState("");
  const [consolidating, setConsolidating] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const noteChanges = props.messages.flatMap((message) => message.noteChanges ?? []);
  const latestAssistant = [...props.messages].reverse().find((message) => message.role === "brain" && message.id);
  const suggestConsolidation = shouldSuggestVaultConsolidation(latestAssistant);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [props.messages]);

  function handleWheelSwipe(e: ReactWheelEvent<HTMLDivElement>) {
    if (Math.abs(e.deltaX) < Math.abs(e.deltaY) * 1.4 || Math.abs(e.deltaX) < 12) return;
    const now = Date.now();
    const current = wheelSwipeRef.current;
    if (now - current.lastAt > 450) current.total = 0;
    current.lastAt = now;
    current.total += e.deltaX;
    if (current.total < -180) {
      current.total = 0;
      props.onHome();
    }
  }

  async function saveMessageToVault(message: Msg) {
    setActionError("");
    const existing = message.id ? draftOverrides[message.id] ?? message.vaultDrafts?.[0] : undefined;
    if (existing) {
      setVaultDraft(existing);
      return;
    }
    if (!message.id) return;
    setSavingMessageId(message.id);
    try {
      const response = await fetch(`${API}/messages/${message.id}/save-to-vault`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Draft generation failed.");
      const draft = result as VaultDraft;
      setDraftOverrides((current) => ({ ...current, [message.id!]: draft }));
      setVaultDraft(draft);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "The vault draft could not be prepared.");
    } finally {
      setSavingMessageId(null);
    }
  }

  async function finishAndReview() {
    if (consolidating) return;
    setActionError("");
    setConsolidationError("");
    setConsolidationRun(null);
    setConsolidationModalOpen(true);
    setConsolidating(true);
    try {
      const response = await fetch(`${API}/conversations/${props.conversationId}/consolidations`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not create the review.");
      setConsolidationRun(result as ConsolidationRun);
    } catch (reason) {
      setConsolidationError(reason instanceof Error ? reason.message : "The vault could not be consolidated.");
    } finally {
      setConsolidating(false);
    }
  }

  async function copyMessage(message: Msg) {
    setActionError("");
    try {
      await navigator.clipboard.writeText(message.text);
      setCopiedMessageId(message.id ?? null);
      window.setTimeout(() => setCopiedMessageId((current) => current === message.id ? null : current), 1600);
    } catch {
      setActionError("The response could not be copied to the clipboard.");
    }
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onWheel={handleWheelSwipe}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3.5 p-6">
          {props.messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "group/message relative max-w-[88%] rounded-2xl leading-relaxed transition-[background-color,border-color,padding] duration-200",
                m.role === "user"
                  ? "self-end bg-primary px-3.5 py-3 text-primary-foreground whitespace-pre-wrap"
                  : m.pendingSince && !m.text && !m.error
                    ? "self-start border border-transparent bg-transparent px-1 py-1"
                    : "self-start border border-border bg-secondary px-3.5 py-3",
              )}
            >
              {(() => {
                const citations = m.role === "brain" ? buildCitations(m.facts) : [];
                const citationMap = new Map(citations.map((citation) => [citation.number, citation]));
                const markdownComponents = createMarkdownComponents(citationMap, props.onOpenNote);
                return m.role === "brain" ? (
                  <div className="md text-[15px]">
                    <AnimatePresence initial={false}>
                      {m.pendingSince && (
                        <ThinkingIndicator
                          since={m.pendingSince}
                          label={i18n.locale?.startsWith("fr") ? "Réflexion" : "Thinking"}
                        />
                      )}
                    </AnimatePresence>
                    {m.error ? (
                      <ChatErrorPanel error={m.error} />
                    ) : m.text ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                          {m.text}
                        </ReactMarkdown>
                    ) : (
                      !m.pendingSince && <span className="text-muted-foreground">…</span>
                    )}
                    {m.actions && m.actions.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {m.actions.map((action, actionIndex) => action.type === "tool_call" ? (
                          <div key={`${action.type}-${action.name}-${actionIndex}`} className="w-full">
                            <ToolActivity action={action} sources={m.sources} />
                          </div>
                        ) : (
                          <button
                            type="button"
                            key={`${action.type}-${action.conversation_id}`}
                            onClick={() => props.onOpenConversation(action.conversation_id)}
                            className="inline-flex max-w-full cursor-pointer items-center gap-2 rounded-full border border-border bg-background px-2.5 py-1.5 text-left text-[13px] leading-5 transition-colors hover:border-primary/50 hover:bg-accent"
                          >
                            <Icon name="pencil-1" className="text-[15px] text-muted-foreground" />
                            <span className="min-w-0 truncate">{action.title}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {citations.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {citations.map((citation) => {
                          const note = citationToVaultNote(citation);
                          const content = (
                            <>
                              <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[11px] font-medium leading-none text-foreground/80">
                                {citation.number}
                              </span>
                              <span className="h-5 min-w-0 truncate text-[13px] leading-5">{citation.title}</span>
                            </>
                          );
                          return note ? (
                            <button
                              type="button"
                              key={citation.number}
                              onClick={(e) => {
                                e.preventDefault();
                                props.onOpenNote(note);
                              }}
                              className="inline-flex max-w-full cursor-pointer items-center gap-2 rounded-full border border-border bg-background px-2 py-1 text-left transition-colors hover:border-primary/50 hover:bg-accent"
                            >
                              {content}
                            </button>
                          ) : (
                            <span
                              key={citation.number}
                              className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-background px-2 py-1 text-left"
                            >
                              {content}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  m.text
                );
              })()}
              {m.role === "user" && (
                <div className="mt-2 flex h-7 items-center gap-0.5 opacity-65 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => props.onSend(m.text, [])}
                    disabled={props.busy || m.text.includes("\n\n📎 ")}
                    title={m.text.includes("\n\n📎 ")
                      ? "Messages with attachments cannot be regenerated without reattaching the files"
                      : "Regenerate from this message"}
                    aria-label="Regenerate from this message"
                    className="inline-flex size-7 items-center justify-center rounded-md text-primary-foreground/70 transition-colors hover:bg-primary-foreground/10 hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <RotateCcw className="size-3.5" />
                  </button>
                  <MessageTimestamp iso={m.createdAt} role={m.role} locale={i18n.locale || "en"} inline />
                </div>
              )}
              {m.role === "brain" && m.id && m.text && (
                <div className="mt-2 flex h-7 items-center gap-0.5 opacity-65 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
                  <button type="button" onClick={() => void copyMessage(m)} className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground" title="Copy response" aria-label="Copy response">
                    {copiedMessageId === m.id ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const previous = props.messages[i - 1];
                      if (previous?.role === "user") props.onRegenerate(previous.text, m.id!);
                    }}
                    disabled={props.busy || latestAssistant?.id !== m.id || Boolean(m.noteChanges?.length) || Boolean(m.vaultDrafts?.length) || Boolean(draftOverrides[m.id]) || props.messages[i - 1]?.text.includes("\n\n📎 ")}
                    className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                    title={props.messages[i - 1]?.text.includes("\n\n📎 ")
                      ? "Responses with attachments cannot be regenerated without reattaching the files"
                      : latestAssistant?.id === m.id
                        ? "Regenerate response"
                        : "Only the latest response can be regenerated"}
                    aria-label="Regenerate response"
                  >
                    <RotateCcw className="size-3.5" />
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        disabled={savingMessageId === m.id || props.busy || Boolean(m.error)}
                        className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground disabled:opacity-50"
                        title="Save or consolidate this response"
                      >
                        <BookMarked className="size-3.5" />
                        {savingMessageId === m.id ? "Preparing…" : "Save"}
                        <ChevronDown className="size-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-64">
                      <DropdownMenuItem onSelect={() => void saveMessageToVault(m)} className="items-start py-2">
                        <FilePlus2 className="mt-0.5 size-4" />
                        <span><span className="block text-[13px] font-medium">Save as a new note</span><span className="block text-[11px] text-muted-foreground">Review the filename, folder, and Markdown.</span></span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void finishAndReview()} className="items-start py-2">
                        <Sparkles className="mt-0.5 size-4" />
                        <span><span className="block text-[13px] font-medium">Consolidate vault</span><span className="block text-[11px] text-muted-foreground">Find and update the most relevant notes.</span></span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <MessageTimestamp iso={m.createdAt} role={m.role} locale={i18n.locale || "en"} inline />
                </div>
              )}
              {(() => {
                const memoryFacts = (m.facts ?? []).filter((fact) => fact.source_type !== "external" && fact.source_type !== "web_page");
                if (memoryFacts.length === 0) return null;
                return (
                <details className="group/facts mt-3 text-[13px]">
                  <summary className="cursor-pointer select-none text-[12px] text-muted-foreground transition-colors hover:text-foreground">
                    {memoryFacts.length} {memoryFacts.length === 1 ? "memory fact" : "memory facts"}
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {memoryFacts.map((f, j) => {
                      const isNote = f.source_type === "note"
                        || Boolean(f.note_path)
                        || Boolean(f.note_title && f.source_type !== "chat");
                      const note = isNote && f.note_path
                        ? citationToVaultNote({
                            number: f.citation_number ?? j + 1,
                            title: f.note_title || f.source_title || f.note_path,
                            path: f.note_path,
                            anchor: f.citation_anchor,
                          })
                        : null;
                      const canOpen = Boolean(note || (!isNote && f.conversation_id));
                      const sourceLabel = isNote
                        ? f.note_title || f.source_title || "Note"
                        : f.source_title || "Conversation";
                      const hoverLabel = canOpen
                        ? isNote
                          ? `Preview note: ${sourceLabel}`
                          : `Preview conversation: ${sourceLabel}`
                        : isNote
                          ? "Source note unavailable"
                          : "Source conversation unavailable";
                      return (
                        <li key={j}>
                          <TooltipProvider delayDuration={250}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  aria-disabled={!canOpen}
                                  onClick={() => {
                                    if (note) props.onOpenNote(note);
                                    else if (f.conversation_id) props.onPreviewConversation(f.conversation_id);
                                  }}
                                  className={cn(
                                    "flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground",
                                    canOpen ? "cursor-pointer" : "cursor-help",
                                  )}
                                >
                                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-background/70">
                                    {isNote ? <FileText className="size-3.5" /> : <MessageCircle className="size-3.5" />}
                                  </span>
                                  <span className="min-w-0 flex-1 leading-5">
                                    <ObsidianMarkdown compact className="memory-fact-excerpt text-foreground/85">
                                      {f.citation_anchor?.quote || f.fact.slice(0, 520)}
                                    </ObsidianMarkdown>
                                    <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                                      <span className="truncate">{sourceLabel}</span>
                                      {f.heading_path && <><span aria-hidden>·</span><span className="truncate">{markdownLabel(f.heading_path)}</span></>}
                                      {f.citation_anchor?.start.line && (
                                        <><span aria-hidden>·</span><span className="shrink-0 tabular-nums">L{f.citation_anchor.start.line}{f.citation_anchor.end.line && f.citation_anchor.end.line !== f.citation_anchor.start.line ? `–${f.citation_anchor.end.line}` : ""}</span></>
                                      )}
                                    </span>
                                  </span>
                                  {f.valid_at && (
                                    <span className="shrink-0 pt-0.5 text-[10px] tabular-nums text-muted-foreground/70">
                                      {f.valid_at.slice(0, 10)}
                                    </span>
                                  )}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="right" sideOffset={8}>
                                {hoverLabel}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </li>
                      );
                    })}
                  </ul>
                </details>
                );
              })()}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </div>
      <div className="mx-auto mb-4 w-full max-w-3xl px-6">
        {actionError && (
          <div role="alert" className="mb-2 flex items-start justify-between gap-3 rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
            <span>{actionError}</span>
            <button type="button" onClick={() => setActionError("")} aria-label="Dismiss error"><X className="size-3.5" /></button>
          </div>
        )}
        {suggestConsolidation && (
          <TooltipProvider delayDuration={250}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => void finishAndReview()}
                  disabled={consolidating || props.busy}
                  className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/8 px-3 py-1.5 text-left text-[12px] text-foreground shadow-sm transition-colors hover:border-primary/55 hover:bg-primary/12 disabled:opacity-50"
                >
                  <Sparkles className={cn("size-3.5 shrink-0 text-primary", consolidating && "animate-pulse")} />
                  <span className="font-medium">{consolidating ? "Analyzing vault…" : "Consolidate vault"}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>
                Integrate this new knowledge into the right notes
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <Composer
          busy={props.busy}
          onSend={props.onSend}
          folders={props.folders}
          projectId={props.projectId}
          onProjectChange={props.onProjectChange}
          mode={props.mode}
          onModeChange={props.onModeChange}
          vaultPath={props.vaultPath}
          changes={noteChanges}
          onOpenChanges={() => setChangesOpen(true)}
          draft={props.composerDraft}
          onDraftChange={props.onComposerDraftChange}
        />
      </div>
      <AnimatePresence>
        {changesOpen && <ChangeDiffModal changes={noteChanges} onClose={() => setChangesOpen(false)} />}
        {vaultDraft && (
          <SaveToVaultModal
            draft={vaultDraft}
            onClose={() => setVaultDraft(null)}
            onSaved={(draft) => {
              setVaultDraft(draft);
              setDraftOverrides((current) => ({ ...current, [draft.messageId]: draft }));
            }}
            onOpenNote={(draft) => {
              setVaultDraft(null);
              props.onOpenNote({
                title: draft.title,
                path: draft.targetPath,
                folder: draft.targetPath.split("/").slice(0, -1).join("/"),
                modifiedAt: new Date().toISOString(),
              });
            }}
          />
        )}
        {consolidationModalOpen && (
          consolidationRun ? (
            <ConsolidationReviewModal
              key={consolidationRun.id}
              run={consolidationRun}
              onClose={() => setConsolidationModalOpen(false)}
              onOpenNote={props.onOpenNote}
            />
          ) : (
            <ConsolidationProgressModal
              key={consolidationError ? "error" : "progress"}
              error={consolidationError}
              onClose={() => setConsolidationModalOpen(false)}
              onRetry={() => void finishAndReview()}
            />
          )
        )}
      </AnimatePresence>
    </div>
  );
}
