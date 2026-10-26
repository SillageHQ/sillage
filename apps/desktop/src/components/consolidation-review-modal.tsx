import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { motion } from "motion/react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { ArrowRight, Check, ChevronRight, Code2, Eye, FilePenLine, FilePlus2, FileText, Gauge, Lightbulb, Link2, LoaderCircle, MessageSquare, Pencil, RefreshCw, Search, ShieldCheck, Sparkles, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { API_URL as API } from "@/lib/api";
import type { VaultNote } from "@/components/vault-explorer";

const MARKDOWN_SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: Array.from(new Set([...(defaultSchema.tagNames ?? []), "u"])),
};

type ProposalSource = { notePath?: string; title?: string; excerpt?: string; messageId?: string };
export type KnowledgeProposal = {
  id: string;
  kind: "create" | "update" | "move" | "merge" | "delete";
  targetPath: string;
  beforeHash: string | null;
  beforeContent: string;
  afterContent: string;
  rationale: string;
  confidence: "low" | "medium" | "high";
  risk: "safe" | "structural" | "destructive";
  decision: "pending" | "accepted" | "rejected";
  applyStatus: "pending" | "applied_pending_sync" | "synced" | "failed" | "stale";
  sources?: ProposalSource[];
};
export type ProposalReviewRun = {
  id: string;
  status: string;
  summary: string;
  proposals: KnowledgeProposal[];
};
export type ConsolidationRun = ProposalReviewRun & {
  conversationId: string;
  fromMessageId: string | null;
  throughMessageId: string;
};
export type VaultActionRun = ProposalReviewRun & {
  action: "organize_folder" | "restructure_note" | "rewrite_note" | "structure_idea";
  targetPath: string | null;
};

const ANALYSIS_STAGES = [
  { label: "Finding relevant notes", detail: "Searching your vault for the best places to integrate this knowledge", icon: Search },
  { label: "Comparing knowledge", detail: "Checking what is new, complementary, or already captured", icon: FileText },
  { label: "Drafting updates", detail: "Preparing precise changes without overwriting useful context", icon: FilePenLine },
  { label: "Preparing your review", detail: "Finalizing the proposals you will approve or reject", icon: Sparkles },
];

export function ConsolidationProgressModal(props: {
  error?: string;
  onClose: () => void;
  onRetry: () => void;
}) {
  const [activeStage, setActiveStage] = useState(0);

  useEffect(() => {
    if (props.error) return;
    const interval = window.setInterval(() => {
      setActiveStage((current) => Math.min(current + 1, ANALYSIS_STAGES.length - 1));
    }, 1400);
    return () => window.clearInterval(interval);
  }, [props.error]);

  return (
    <motion.div role="dialog" aria-modal="true" aria-label="Analyzing vault" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-x-0 bottom-0 top-[var(--app-titlebar-height)] z-[80] flex items-center justify-center bg-black/60 p-8 backdrop-blur-sm">
      <motion.div initial={{ opacity: 0, y: 8, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 5, scale: 0.99 }} className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
        <header className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span className="relative flex size-9 items-center justify-center rounded-lg border border-primary/25 bg-primary/8 text-primary">
            {props.error ? <X className="size-4" /> : <Sparkles className="size-4 animate-pulse" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-medium">{props.error ? "Vault analysis stopped" : "Analyzing your vault"}</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Nothing will be written without your approval.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={props.onClose} aria-label="Close"><X className="size-4" /></Button>
        </header>

        <div className="p-5">
          {props.error ? (
            <div role="alert" className="rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-3 text-[12px] leading-5 text-destructive">{props.error}</div>
          ) : (
            <>
              <div className="mb-5 h-1 overflow-hidden rounded-full bg-muted">
                <motion.div className="h-full rounded-full bg-primary" animate={{ width: `${((activeStage + 1) / ANALYSIS_STAGES.length) * 100}%` }} transition={{ duration: 0.45, ease: "easeOut" }} />
              </div>
              <div className="space-y-2">
                {ANALYSIS_STAGES.map((stage, index) => {
                  const Icon = stage.icon;
                  const complete = index < activeStage;
                  const active = index === activeStage;
                  return (
                    <motion.div key={stage.label} animate={{ opacity: index <= activeStage ? 1 : 0.42 }} className={cn("flex items-center gap-3 rounded-lg border px-3 py-3 transition-colors", active ? "border-primary/30 bg-primary/5" : "border-transparent")}>
                      <span className="relative flex size-9 shrink-0 items-center justify-center">
                        {active && <span className="absolute inset-0 animate-spin rounded-full border-2 border-primary/15 border-t-primary" />}
                        <span className={cn("flex size-7 items-center justify-center rounded-full border", complete ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500" : active ? "border-primary/30 bg-background text-primary" : "border-border text-muted-foreground")}>
                          {complete ? <Check className="size-3" /> : <Icon className={cn("size-3", active && "animate-pulse")} />}
                        </span>
                      </span>
                      <span className="min-w-0"><span className="block text-[12px] font-medium">{stage.label}</span><span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{stage.detail}</span></span>
                    </motion.div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-border bg-card/40 px-5 py-4">
          <span className="text-[11px] text-muted-foreground">{props.error ? "Your vault was not changed." : "This can take a few moments."}</span>
          {props.error && <Button onClick={props.onRetry}>Try again</Button>}
        </footer>
      </motion.div>
    </motion.div>
  );
}

type DiffRow = { before: string | null; after: string | null; changed: boolean };
type DiffViewport = { top: number; height: number };
type DiffRange = { start: number; end: number };
type SelectedChange = { side: "before" | "after"; startLine: number; endLine: number; excerpt: string };
type ChangeAction = "choose" | "ai" | "manual";
type ChangeMenuPosition = { top: number; left: number };
type MarkdownHastNode = {
  type?: string;
  position?: { start: { line: number }; end: { line: number } };
  properties?: Record<string, unknown>;
  children?: MarkdownHastNode[];
};

function diffRows(before: string, after: string): DiffRow[] {
  const left = before.split("\n");
  const right = after.split("\n");
  return Array.from({ length: Math.max(left.length, right.length) }, (_, index) => ({
    before: left[index] ?? null,
    after: right[index] ?? null,
    changed: left[index] !== right[index],
  }));
}

function diffRanges(rows: DiffRow[], side: "before" | "after"): DiffRange[] {
  const ranges: DiffRange[] = [];
  rows.forEach((row, index) => {
    if (!row.changed || row[side] === null) return;
    const previous = ranges[ranges.length - 1];
    if (previous?.end === index - 1) previous.end = index;
    else ranges.push({ start: index, end: index });
  });
  return ranges;
}

function rangesOverlappingLines(ranges: DiffRange[], startLine: number, endLine: number): DiffRange | null {
  const matches = ranges.filter((range) => range.end + 1 >= startLine && range.start + 1 <= endLine);
  if (matches.length === 0) return null;
  return { start: matches[0].start, end: matches[matches.length - 1].end };
}

function rehypeDiffHighlight(ranges: DiffRange[], side: "before" | "after", selectedChange: SelectedChange | null) {
  const className = side === "before" ? "markdown-diff-removed" : "markdown-diff-added";
  return () => (tree: MarkdownHastNode) => {
    for (const node of tree.children ?? []) {
      const start = node.position?.start.line;
      const end = node.position?.end.line;
      if (!start || !end) continue;
      const range = rangesOverlappingLines(ranges, start, end);
      if (!range) continue;
      const rangeStartLine = range.start + 1;
      const rangeEndLine = range.end + 1;
      node.properties ??= {};
      const selected = selectedChange?.side === side && selectedChange.startLine === rangeStartLine && selectedChange.endLine === rangeEndLine;
      node.properties.className = `${className} markdown-diff-clickable${selected ? " markdown-diff-selected" : ""}`;
      node.properties["data-diff-start-line"] = rangeStartLine;
      node.properties["data-diff-end-line"] = rangeEndLine;
      node.properties["data-diff-side"] = side;
      node.properties.role = "button";
      node.properties.tabIndex = 0;
      node.properties["aria-label"] = `Improve this ${side === "before" ? "removed" : "added"} change`;
    }
  };
}

function DiffMinimap(props: {
  rows: DiffRow[];
  viewport: DiffViewport;
  onSeek: (ratio: number) => void;
}) {
  const count = Math.max(props.rows.length, 1);
  const removedRanges = diffRanges(props.rows, "before");
  const addedRanges = diffRanges(props.rows, "after");
  return (
    <button
      type="button"
      aria-label="Diff overview. Click to scroll to a change."
      className="relative w-4 shrink-0 overflow-hidden border-l border-border bg-background/80"
      onPointerDown={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        props.onSeek((event.clientY - bounds.top) / bounds.height);
      }}
    >
      <span
        className="pointer-events-none absolute inset-x-0 rounded-sm border border-foreground/15 bg-foreground/5"
        style={{ top: `${props.viewport.top}%`, height: `${props.viewport.height}%` }}
      />
      {removedRanges.map((range) => (
        <span
          key={`removed-${range.start}`}
          className="pointer-events-none absolute left-0 w-1/2 bg-red-500"
          style={{ top: `${(range.start / count) * 100}%`, height: `max(2px, ${((range.end - range.start + 1) / count) * 100}%)` }}
        />
      ))}
      {addedRanges.map((range) => (
        <span
          key={`added-${range.start}`}
          className="pointer-events-none absolute right-0 w-1/2 bg-emerald-400"
          style={{ top: `${(range.start / count) * 100}%`, height: `max(2px, ${((range.end - range.start + 1) / count) * 100}%)` }}
        />
      ))}
    </button>
  );
}

function InspectorHeading(props: { icon: LucideIcon; children: string }) {
  const Icon = props.icon;
  return (
    <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
      <Icon className="size-3.5" />
      <span>{props.children}</span>
    </div>
  );
}

const CONFIDENCE_BARS = [
  { height: "h-[6px]", color: "bg-red-500" },
  { height: "h-[9px]", color: "bg-orange-500" },
  { height: "h-[12px]", color: "bg-amber-400" },
  { height: "h-[15px]", color: "bg-lime-400" },
  { height: "h-[18px]", color: "bg-emerald-400" },
];

function ConfidenceMeter(props: { confidence: KnowledgeProposal["confidence"] }) {
  const level = props.confidence === "high" ? 5 : props.confidence === "medium" ? 3 : 1;
  return (
    <div className="mt-3 flex items-end gap-3" role="img" aria-label={`${props.confidence} confidence, level ${level} of 5`}>
      <div className="flex h-6 flex-1 items-end gap-1.5">
        {CONFIDENCE_BARS.map((bar, index) => (
          <span key={bar.height} className="relative flex flex-1 items-end">
            <span className={cn("w-full transition-opacity", bar.height, bar.color, index < level ? "opacity-90" : "opacity-15")} />
            {index === level - 1 && (
              <svg aria-hidden="true" viewBox="0 0 20 12" className="absolute -bottom-3.5 left-1/2 h-2.5 w-[18px] -translate-x-1/2 fill-foreground drop-shadow-sm">
                <path d="M2.6 11C1.15 11 .45 9.28 1.45 8.24L8.3 1.12a2.35 2.35 0 0 1 3.4 0l6.85 7.12c1 1.04.3 2.76-1.15 2.76H2.6Z" />
              </svg>
            )}
          </span>
        ))}
      </div>
      <span className="min-w-12 text-right text-[12px] font-medium capitalize text-foreground">{props.confidence}</span>
    </div>
  );
}

export function ConsolidationReviewModal(props: {
  run: ProposalReviewRun;
  onClose: () => void;
  onOpenNote: (note: VaultNote) => void;
  apiPath?: string;
  title?: string;
}) {
  const [proposals, setProposals] = useState(props.run.proposals);
  const [selectedId, setSelectedId] = useState(props.run.proposals[0]?.id ?? "");
  const [editing, setEditing] = useState(false);
  const [viewMode, setViewMode] = useState<"diff" | "markdown">("diff");
  const [confirming, setConfirming] = useState(false);
  const [destructiveConfirmed, setDestructiveConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedChange, setSelectedChange] = useState<SelectedChange | null>(null);
  const [changeAction, setChangeAction] = useState<ChangeAction>("choose");
  const [changeMenuPosition, setChangeMenuPosition] = useState<ChangeMenuPosition | null>(null);
  const [refinePrompt, setRefinePrompt] = useState("");
  const [refining, setRefining] = useState(false);
  const [manualContent, setManualContent] = useState("");
  const [savingManualEdit, setSavingManualEdit] = useState(false);
  const changeMenuRef = useRef<HTMLDivElement>(null);
  const diffScrollRef = useRef<HTMLDivElement>(null);
  const [diffViewport, setDiffViewport] = useState<DiffViewport>({ top: 0, height: 100 });
  const selected = proposals.find((proposal) => proposal.id === selectedId);
  const rows = useMemo(() => diffRows(selected?.beforeContent ?? "", selected?.afterContent ?? ""), [selected]);
  const beforeRanges = useMemo(() => diffRanges(rows, "before"), [rows]);
  const afterRanges = useMemo(() => diffRanges(rows, "after"), [rows]);
  const accepted = proposals.filter((proposal) => proposal.decision === "accepted" && proposal.applyStatus === "pending");
  const hasDestructive = accepted.some((proposal) => proposal.risk === "destructive");
  const waitingForSync = proposals.some((proposal) => proposal.applyStatus === "applied_pending_sync");
  const apiPath = props.apiPath ?? `/consolidations/${props.run.id}`;

  function updateDiffViewport(element: HTMLDivElement) {
    const height = Math.min(100, (element.clientHeight / Math.max(element.scrollHeight, 1)) * 100);
    const top = (element.scrollTop / Math.max(element.scrollHeight, 1)) * 100;
    setDiffViewport({ top, height });
  }

  function handleDiffScroll(element: HTMLDivElement) {
    updateDiffViewport(element);
    setChangeMenuPosition(null);
    if (changeAction === "choose") setSelectedChange(null);
  }

  function seekDiff(ratio: number) {
    const element = diffScrollRef.current;
    if (!element) return;
    element.scrollTo({
      top: Math.max(0, ratio * element.scrollHeight - element.clientHeight / 2),
      behavior: "smooth",
    });
  }

  useEffect(() => {
    const element = diffScrollRef.current;
    if (!element) return;
    element.scrollTo({ top: 0, left: 0 });
    updateDiffViewport(element);
  }, [selectedId, viewMode]);

  useEffect(() => {
    setSelectedChange(null);
    setChangeMenuPosition(null);
    setRefinePrompt("");
  }, [selectedId]);

  function selectChangeRange(target: HTMLElement, side: "before" | "after", content: string, startLine: number, endLine: number) {
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) return;
    setSelectedChange({
      side,
      startLine,
      endLine,
      excerpt: content.split("\n").slice(startLine - 1, endLine).join("\n"),
    });
    const bounds = target.getBoundingClientRect();
    setChangeMenuPosition({
      top: Math.min(window.innerHeight - 112, bounds.bottom + 6),
      left: Math.max(12, Math.min(window.innerWidth - 196, bounds.left + 12)),
    });
    setChangeAction("choose");
    setRefinePrompt("");
    setError("");
  }

  function selectMarkdownChange(target: HTMLElement, side: "before" | "after", content: string) {
    selectChangeRange(target, side, content, Number(target.dataset.diffStartLine), Number(target.dataset.diffEndLine));
  }

  function selectDiffChange(target: HTMLElement, side: "before" | "after", lineIndex: number, content: string) {
    const ranges = side === "before" ? beforeRanges : afterRanges;
    const range = ranges.find((item) => item.start <= lineIndex && item.end >= lineIndex);
    if (!range) return;
    selectChangeRange(target, side, content, range.start + 1, range.end + 1);
  }

  useEffect(() => {
    if (!changeMenuPosition || changeAction !== "choose") return;
    const closeMenu = (event: PointerEvent) => {
      if (!changeMenuRef.current?.contains(event.target as Node)) {
        setSelectedChange(null);
        setChangeMenuPosition(null);
      }
    };
    document.addEventListener("pointerdown", closeMenu, true);
    return () => document.removeEventListener("pointerdown", closeMenu, true);
  }, [changeAction, changeMenuPosition]);

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || !selectedChange) return;
      setSelectedChange(null);
      setChangeMenuPosition(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [selectedChange]);

  function beginAiRework() {
    setChangeAction("ai");
    setChangeMenuPosition(null);
  }

  function beginManualEdit() {
    if (!selected || !selectedChange) return;
    const lines = selected.afterContent.split("\n");
    setManualContent(lines.slice(selectedChange.startLine - 1, selectedChange.endLine).join("\n"));
    setChangeAction("manual");
    setChangeMenuPosition(null);
  }

  function handleMarkdownClick(event: MouseEvent<HTMLDivElement>, side: "before" | "after", content: string) {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-diff-start-line]");
    if (target && event.currentTarget.contains(target)) selectMarkdownChange(target, side, content);
  }

  function handleMarkdownKeyDown(event: KeyboardEvent<HTMLDivElement>, side: "before" | "after", content: string) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-diff-start-line]");
    if (!target || !event.currentTarget.contains(target)) return;
    event.preventDefault();
    selectMarkdownChange(target, side, content);
  }

  function handleDiffKeyDown(event: KeyboardEvent<HTMLDivElement>, side: "before" | "after", lineIndex: number, content: string) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectDiffChange(event.currentTarget, side, lineIndex, content);
  }

  async function updateProposal(id: string, patch: Partial<Pick<KnowledgeProposal, "decision" | "afterContent" | "targetPath">>) {
    setError("");
    const response = await fetch(`${API}${apiPath}/proposals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const updated = await response.json();
    if (!response.ok) throw new Error(updated.error || "Could not update the proposal.");
    setProposals((items) => items.map((item) => item.id === id ? { ...item, ...updated } : item));
  }

  async function refineSelectedChange() {
    if (!selected || !selectedChange || !refinePrompt.trim()) return;
    setRefining(true);
    setError("");
    try {
      const response = await fetch(`${API}${apiPath}/proposals/${selected.id}/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: refinePrompt.trim(),
          selectedSide: selectedChange.side,
          selectedStartLine: selectedChange.startLine,
          selectedEndLine: selectedChange.endLine,
        }),
      });
      const updated = await response.json();
      if (!response.ok) throw new Error(updated.error || "Could not improve the selected change.");
      setProposals((items) => items.map((item) => item.id === selected.id ? { ...item, ...updated } : item));
      setSelectedChange(null);
      setRefinePrompt("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not improve the selected change.");
    } finally {
      setRefining(false);
    }
  }

  async function saveManualChange() {
    if (!selected || !selectedChange) return;
    setSavingManualEdit(true);
    setError("");
    try {
      const lines = selected.afterContent.split("\n");
      const start = Math.max(0, Math.min(selectedChange.startLine - 1, lines.length));
      const end = Math.max(start, Math.min(selectedChange.endLine, lines.length));
      const replacement = manualContent === "" ? [] : manualContent.split("\n");
      lines.splice(start, end - start, ...replacement);
      await updateProposal(selected.id, { afterContent: lines.join("\n"), decision: "pending" });
      setSelectedChange(null);
      setChangeMenuPosition(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the manual edit.");
    } finally {
      setSavingManualEdit(false);
    }
  }

  async function acceptAllSafe() {
    setBusy(true);
    try {
      await Promise.all(proposals
        .filter((proposal) => proposal.risk === "safe" && proposal.decision === "pending")
        .map((proposal) => updateProposal(proposal.id, { decision: "accepted" })));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not accept the proposals.");
    } finally {
      setBusy(false);
    }
  }

  async function applyApproved() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API}${apiPath}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmedCurator: true }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not apply the approved changes.");
      setProposals(result.proposals);
      setConfirming(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not apply the approved changes.");
    } finally {
      setBusy(false);
    }
  }

  async function rejectReview() {
    setBusy(true);
    try {
      const response = await fetch(`${API}${apiPath}/reject`, { method: "POST" });
      if (!response.ok) throw new Error("Could not resolve the review.");
      props.onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not resolve the review.");
    } finally {
      setBusy(false);
    }
  }

  async function retrySync() {
    setBusy(true);
    try {
      await fetch(`${API}${apiPath}/retry-sync`, { method: "POST" });
      const response = await fetch(`${API}${apiPath}`);
      const result = await response.json();
      if (response.ok) setProposals(result.proposals);
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div role="dialog" aria-modal="true" aria-label={props.title ?? "Conversation review"} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-x-0 bottom-0 top-[var(--app-titlebar-height)] z-[80] flex bg-background">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex h-full min-h-0 w-full overflow-hidden bg-background">
        <aside className="min-h-0 w-72 shrink-0 overflow-y-auto border-r border-border bg-sidebar p-3">
          <div className="px-2 pb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{proposals.length} {proposals.length === 1 ? "proposal" : "proposals"}</div>
          {proposals.map((proposal) => (
            <button key={proposal.id} type="button" onClick={() => { setSelectedId(proposal.id); setEditing(false); }} className={cn("mb-1 flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-[12px]", proposal.id === selectedId ? "bg-sidebar-accent" : "text-muted-foreground hover:bg-sidebar-accent/60")}>
              {proposal.kind === "create" ? <FilePlus2 className="mt-0.5 size-3.5 text-emerald-500" /> : <FilePenLine className="mt-0.5 size-3.5 text-emerald-500" />}
              <span className="min-w-0 flex-1"><span className="block truncate text-foreground/90">{proposal.targetPath.split("/").pop()}</span><span className="block truncate text-[10px]">{proposal.targetPath}</span></span>
              <span className={cn("mt-1 size-1.5 rounded-full", proposal.decision === "accepted" ? "bg-emerald-500" : proposal.decision === "rejected" ? "bg-destructive" : "bg-muted-foreground/40")} />
            </button>
          ))}
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex shrink-0 items-center gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0 flex-1"><h2 className="text-[14px] font-medium">{props.title ?? "Review vault changes"}</h2></div>
            <Button variant="ghost" size="icon" onClick={props.onClose}><X className="size-4" /></Button>
          </header>

          {selected ? (
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] overflow-hidden">
              <div className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border">
                <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
                  {editing ? <Input value={selected.targetPath} onChange={(event) => setProposals((items) => items.map((item) => item.id === selected.id ? { ...item, targetPath: event.target.value } : item))} className="h-7 text-[12px]" /> : <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{selected.targetPath}</span>}
                  {!editing && (
                    <div className="flex shrink-0 rounded-md border border-border bg-background p-0.5 text-[10px]">
                      <button type="button" aria-pressed={viewMode === "diff"} onClick={() => setViewMode("diff")} className={cn("inline-flex h-6 items-center gap-1 rounded px-2 text-muted-foreground transition-colors", viewMode === "diff" && "bg-accent text-foreground shadow-sm")}><Code2 className="size-3" /> Diff</button>
                      <button type="button" aria-pressed={viewMode === "markdown"} onClick={() => setViewMode("markdown")} className={cn("inline-flex h-6 items-center gap-1 rounded px-2 text-muted-foreground transition-colors", viewMode === "markdown" && "bg-accent text-foreground shadow-sm")}><Eye className="size-3" /> Markdown</button>
                    </div>
                  )}
                </div>
                {editing ? (
                  <Textarea value={selected.afterContent} onChange={(event) => setProposals((items) => items.map((item) => item.id === selected.id ? { ...item, afterContent: event.target.value } : item))} className="min-h-0 flex-1 resize-none rounded-none border-0 p-4 font-mono text-[11px] leading-5 focus-visible:ring-0" />
                ) : (
                  <div className="flex min-h-0 flex-1 overflow-hidden bg-card/30 text-[11px] leading-5">
                    <div ref={diffScrollRef} onScroll={(event) => handleDiffScroll(event.currentTarget)} className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain">
                      {viewMode === "diff" ? (
                        <div className="font-mono">
                          <div className="sticky top-0 z-10 grid min-w-[760px] grid-cols-2 border-b border-border bg-card text-muted-foreground"><div className="border-r border-border px-4 py-2">Before</div><div className="px-4 py-2">After</div></div>
                          {rows.map((row, index) => (
                            <div key={index} className="grid min-w-[760px] grid-cols-2">
                              <div
                                role={row.changed && row.before !== null ? "button" : undefined}
                                tabIndex={row.changed && row.before !== null ? 0 : undefined}
                                aria-label={row.changed && row.before !== null ? "Edit this removed change" : undefined}
                                onClick={(event) => row.changed && row.before !== null && selectDiffChange(event.currentTarget, "before", index, selected.beforeContent)}
                                onKeyDown={(event) => row.changed && row.before !== null && handleDiffKeyDown(event, "before", index, selected.beforeContent)}
                                className={cn(
                                  "flex border-r border-border/70",
                                  row.changed && row.before !== null && "cursor-pointer bg-destructive/10 hover:brightness-110 focus-visible:outline-none",
                                  selectedChange?.side === "before" && index >= selectedChange.startLine - 1 && index <= selectedChange.endLine - 1 && "shadow-[inset_3px_0_var(--primary)]",
                                )}
                              >
                                <span className="w-9 shrink-0 pr-2 text-right text-muted-foreground/40">{row.before === null ? "" : index + 1}</span><span className="whitespace-pre-wrap break-all px-2">{row.before ?? ""}</span>
                              </div>
                              <div
                                role={row.changed && row.after !== null ? "button" : undefined}
                                tabIndex={row.changed && row.after !== null ? 0 : undefined}
                                aria-label={row.changed && row.after !== null ? "Edit this added change" : undefined}
                                onClick={(event) => row.changed && row.after !== null && selectDiffChange(event.currentTarget, "after", index, selected.afterContent)}
                                onKeyDown={(event) => row.changed && row.after !== null && handleDiffKeyDown(event, "after", index, selected.afterContent)}
                                className={cn(
                                  "flex",
                                  row.changed && row.after !== null && "cursor-pointer bg-emerald-500/10 hover:brightness-110 focus-visible:outline-none",
                                  selectedChange?.side === "after" && index >= selectedChange.startLine - 1 && index <= selectedChange.endLine - 1 && "shadow-[inset_3px_0_var(--primary)]",
                                )}
                              >
                                <span className="w-9 shrink-0 pr-2 text-right text-muted-foreground/40">{row.after === null ? "" : index + 1}</span><span className="whitespace-pre-wrap break-all px-2">{row.after ?? ""}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="grid min-h-full min-w-[760px] grid-cols-2 bg-background text-[14px] leading-6">
                          <section className="border-r border-border">
                            <div className="sticky top-0 z-10 border-b border-border bg-card px-5 py-2 text-[11px] text-muted-foreground">Before · rendered Markdown</div>
                            <div className="md p-6" onClick={(event) => handleMarkdownClick(event, "before", selected.beforeContent)} onKeyDown={(event) => handleMarkdownKeyDown(event, "before", selected.beforeContent)}>{selected.beforeContent.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, [rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA], rehypeDiffHighlight(beforeRanges, "before", selectedChange)]}>{selected.beforeContent}</ReactMarkdown> : <p className="italic text-muted-foreground">No existing note. This proposal creates a new one.</p>}</div>
                          </section>
                          <section>
                            <div className="sticky top-0 z-10 border-b border-border bg-card px-5 py-2 text-[11px] text-muted-foreground">After · rendered Markdown</div>
                            <div className="md p-6" onClick={(event) => handleMarkdownClick(event, "after", selected.afterContent)} onKeyDown={(event) => handleMarkdownKeyDown(event, "after", selected.afterContent)}><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, [rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA], rehypeDiffHighlight(afterRanges, "after", selectedChange)]}>{selected.afterContent}</ReactMarkdown></div>
                          </section>
                        </div>
                      )}
                    </div>
                    <DiffMinimap rows={rows} viewport={diffViewport} onSeek={seekDiff} />
                  </div>
                )}
                {selectedChange && changeAction === "ai" && !editing && (
                  <form className="shrink-0 border-t border-border bg-background px-4 py-3" onSubmit={(event) => { event.preventDefault(); void refineSelectedChange(); }}>
                    <div className="mb-2 flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium">Rework selected change with AI</p>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{selectedChange.side === "after" ? "Added" : "Removed"} lines {selectedChange.startLine}–{selectedChange.endLine}: {selectedChange.excerpt.split("\n").join(" ")}</p>
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => setSelectedChange(null)} aria-label="Close AI rework"><X className="size-3.5" /></Button>
                    </div>
                    <div className="flex items-end gap-2">
                      <Textarea autoFocus value={refinePrompt} onChange={(event) => setRefinePrompt(event.target.value)} placeholder="Explain how this change should be improved…" maxLength={2000} rows={2} className="min-h-16 resize-none text-[12px]" />
                      <Button type="submit" disabled={refining || !refinePrompt.trim()} className="shrink-0">{refining ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Improve</Button>
                    </div>
                  </form>
                )}
                {selectedChange && changeAction === "manual" && !editing && (
                  <form className="shrink-0 border-t border-border bg-background px-4 py-3" onSubmit={(event) => { event.preventDefault(); void saveManualChange(); }}>
                    <div className="mb-2 flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium">Edit selected change manually</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">Only this passage in the proposed note will be replaced.</p>
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => setSelectedChange(null)} aria-label="Close manual editor"><X className="size-3.5" /></Button>
                    </div>
                    <div className="flex items-end gap-2">
                      <Textarea autoFocus value={manualContent} onChange={(event) => setManualContent(event.target.value)} rows={4} className="min-h-24 resize-y font-mono text-[12px] leading-5" />
                      <Button type="submit" disabled={savingManualEdit} className="shrink-0">{savingManualEdit ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save</Button>
                    </div>
                  </form>
                )}
              </div>
              <aside className="min-h-0 overflow-y-auto bg-card/15 p-5 text-[12px]">
                <section>
                  <InspectorHeading icon={Lightbulb}>Why</InspectorHeading>
                  <p className="mt-3 border-l-2 border-primary/50 bg-muted/20 px-3 py-2.5 leading-5 text-foreground/90">{selected.rationale}</p>
                </section>

                <section className="mt-6 border-t border-border/70 pt-5">
                  <InspectorHeading icon={Gauge}>Confidence</InspectorHeading>
                  <ConfidenceMeter confidence={selected.confidence} />
                </section>

                <section className="mt-6 border-t border-border/70 pt-5">
                  <InspectorHeading icon={Link2}>Sources</InspectorHeading>
                  <div className="mt-3 overflow-hidden rounded-md border border-border/80 bg-background/50 divide-y divide-border/70">
                    {(selected.sources ?? []).map((source, index) => source.notePath ? (
                      <button key={index} type="button" onClick={() => props.onOpenNote({ title: source.title || source.notePath!.split("/").pop()!.replace(/\.md$/, ""), path: source.notePath!, folder: source.notePath!.split("/").slice(0, -1).join("/"), modifiedAt: "" })} className="group flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
                        <FileText className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
                        <span className="min-w-0 flex-1 truncate text-foreground/90">{source.title || source.notePath}</span>
                        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground" />
                      </button>
                    ) : (
                      <div key={index} className="flex items-center gap-2.5 px-3 py-2.5 text-muted-foreground">
                        {source.messageId ? <MessageSquare className="size-3.5 shrink-0" /> : <Link2 className="size-3.5 shrink-0" />}
                        <span className="min-w-0 flex-1 truncate">{source.title || (source.messageId ? "Conversation message" : "Source")}</span>
                      </div>
                    ))}
                    {(selected.sources ?? []).length === 0 && <div className="px-3 py-2.5 text-muted-foreground">No sources attached</div>}
                  </div>
                </section>
              </aside>
            </div>
          ) : <div className="flex min-h-0 flex-1 items-center justify-center text-[13px] text-muted-foreground">No durable vault changes were found.</div>}

          <footer className="shrink-0 border-t border-border bg-card/70 px-5 py-3 backdrop-blur">
            {error && <p className="mb-3 text-[12px] text-destructive">{error}</p>}
            {confirming && <div className="mb-3 flex items-start gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5 text-[12px]"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" /><div><p>Apply {accepted.length} approved {accepted.length === 1 ? "change" : "changes"} to the vault? The complete batch is checked before any file is written.</p>{hasDestructive && <label className="mt-2 flex items-center gap-2 font-medium text-destructive"><input type="checkbox" checked={destructiveConfirmed} onChange={(event) => setDestructiveConfirmed(event.target.checked)} /> I understand that source notes will be moved to Trash.</label>}</div></div>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap gap-2">
                {waitingForSync && <Button variant="outline" onClick={() => void retrySync()} disabled={busy} className="hover:border-amber-500/35 hover:bg-amber-500/8"><RefreshCw className="size-3.5 text-amber-400" /> Retry sync</Button>}
                <Button variant="ghost" onClick={props.onClose}>Later</Button>
                {selected && <Button variant="outline" onClick={() => void updateProposal(selected.id, { decision: "rejected" })} className="hover:border-destructive/35 hover:bg-destructive/8 hover:text-destructive"><X className="size-3.5 text-destructive" /> Reject</Button>}
                {selected && !editing && <Button variant="outline" onClick={() => setEditing(true)}><Pencil className="size-3.5 text-muted-foreground" /> Edit</Button>}
                {selected && editing && <Button variant="outline" onClick={() => { void updateProposal(selected.id, { afterContent: selected.afterContent, targetPath: selected.targetPath }); setEditing(false); }}><Check className="size-3.5 text-primary" /> Save edit</Button>}
                {selected && <Button variant="outline" onClick={() => void updateProposal(selected.id, { decision: "accepted" })} className="hover:border-emerald-500/35 hover:bg-emerald-500/8"><Check className="size-3.5 text-emerald-400" /> Accept</Button>}
              </div>
              <div className="ml-auto flex flex-wrap justify-end gap-2">
                {proposals.length === 0 ? <Button variant="outline" onClick={() => void rejectReview()} disabled={busy}><Check className="size-3.5 text-emerald-400" /> Resolve review</Button> : <Button variant="outline" onClick={() => void acceptAllSafe()} disabled={busy} className="hover:border-emerald-500/35 hover:bg-emerald-500/8"><ShieldCheck className="size-3.5 text-emerald-400" /> Accept all safe changes</Button>}
                {accepted.length > 0 && !confirming && <Button onClick={() => setConfirming(true)}>Apply approved changes <ArrowRight className="size-3.5" /></Button>}
                {accepted.length > 0 && confirming && <Button onClick={() => void applyApproved()} disabled={busy || (hasDestructive && !destructiveConfirmed)}>{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />} Confirm and apply</Button>}
              </div>
            </div>
          </footer>
        </section>
        {selectedChange && changeAction === "choose" && changeMenuPosition && (
          <motion.div
            ref={changeMenuRef}
            role="menu"
            aria-label="Edit selected change"
            initial={{ opacity: 0, y: -3, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="fixed z-[95] w-44 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl"
            style={{ top: changeMenuPosition.top, left: changeMenuPosition.left }}
          >
            <button autoFocus type="button" role="menuitem" onClick={beginAiRework} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[12px] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
              <Sparkles className="size-3.5 text-primary" />
              <span><span className="block font-medium">Rework with AI</span><span className="block text-[10px] text-muted-foreground">Give a targeted instruction</span></span>
            </button>
            <button type="button" role="menuitem" onClick={beginManualEdit} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[12px] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
              <Pencil className="size-3.5" />
              <span><span className="block font-medium">Edit manually</span><span className="block text-[10px] text-muted-foreground">Rewrite only this passage</span></span>
            </button>
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
}
