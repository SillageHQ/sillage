import { useEffect, useState } from "react";
import { FileAudio, FileText, Link, Search, X } from "lucide-react";
import { t } from "@lingui/core/macro";
import { motion } from "motion/react";
import { API_URL as API } from "@/lib/api";
import { cn } from "@/lib/utils";
import { buildCitations, detectModalCaptureSourceType, obsidianUrl, openObsidianLink } from "@/components/markdown-renderer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CitationAnchor } from "@/components/obsidian-markdown";

type CaptureJobStatus = "queued" | "extracting" | "transcribing" | "summarizing" | "writing_note" | "done" | "failed";
type CaptureJob = { jobId: string; status: CaptureJobStatus; sourceUrl: string; sourceType: "web_page" | "youtube" | "audio_url" | "unknown_url"; summaryDegree: number; destinationFolder: string; title: string | null; notePath: string | null; answer: string | null; facts?: Array<{ citation_number?: number; note_title: string | null; note_path: string | null; citation_anchor?: CitationAnchor }>; error: string | null };

function IngestIcon({ name, className }: { name: string; className?: string }) {
  const icons = { xmark: X, link: Link, search: Search, article: FileText, "audio-file": FileAudio };
  const Glyph = icons[name as keyof typeof icons] ?? Link;
  return <Glyph className={cn("size-[1em] shrink-0", className)} aria-hidden />;
}

export function IngestModal(props: { vaultPath: string; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [instruction, setInstruction] = useState("");
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);
  const [summaryDegree, setSummaryDegree] = useState(3);
  const [destinationFolder, setDestinationFolder] = useState("1. INBOX");
  const [destinationFolders, setDestinationFolders] = useState<string[]>(["1. INBOX"]);
  const [job, setJob] = useState<CaptureJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceType = detectModalCaptureSourceType(url);
  const canSubmit = sourceType !== "unknown_url" && !busy && job?.status !== "done";
  const citations = buildCitations(job?.facts);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onClose]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/capture/folders`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const items = Array.isArray(data.items) ? data.items.filter((item: unknown) => typeof item === "string") : [];
        const next = Array.from(new Set(["1. INBOX", ...items]));
        setDestinationFolders(next);
        if (!next.includes(destinationFolder)) setDestinationFolder("1. INBOX");
      })
      .catch(() => {
        if (!cancelled) setDestinationFolders(["1. INBOX"]);
      });
    return () => {
      cancelled = true;
    };
  }, [destinationFolder]);

  useEffect(() => {
    if (!job?.jobId || job.status === "done" || job.status === "failed") return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(`${API}/capture/jobs/${job.jobId}`);
        const data = (await res.json()) as CaptureJob;
        if (!cancelled) setJob(data);
      } catch {
        if (!cancelled) setError("Could not refresh capture status.");
      }
    }, 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [job?.jobId, job?.status]);

  async function start() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setJob(null);
    try {
      const res = await fetch(`${API}/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          instruction: useCustomPrompt ? instruction.trim() : "",
          summaryDegree,
          destinationFolder,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Capture could not be started.");
        return;
      }
      setJob(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Capture could not be started.");
    } finally {
      setBusy(false);
    }
  }

  const sourceMeta = {
    web_page: { label: "Web page", icon: "article" },
    youtube: { label: "YouTube", icon: "smart-display" },
    audio_url: { label: "Audio URL", icon: "audio-file" },
    unknown_url: { label: "Unknown URL", icon: "help" },
  }[sourceType];

  const statuses: CaptureJobStatus[] = [
    "queued",
    "extracting",
    "transcribing",
    "summarizing",
    "writing_note",
    "done",
  ];
  const activeStatus = job?.status ?? "queued";
  const activeIndex = statuses.indexOf(activeStatus);
  const summaryLabel = ["", "Very short", "Short", "Balanced", "Detailed", "Very detailed"][summaryDegree];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/75 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.99 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-lg border border-border bg-card shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-medium">Ingest content</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Create an Obsidian Inbox note from a URL.</p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            title={t`Close (Esc)`}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <IngestIcon name="xmark" />
          </button>
        </header>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="ingest-url">
              URL
            </label>
            <div className="flex gap-2">
              <Input
                id="ingest-url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setJob(null);
                  setError(null);
                }}
                placeholder="https://..."
                className="h-10"
                autoFocus
              />
              <span className="inline-flex min-w-32 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs text-muted-foreground">
                <IngestIcon name={sourceMeta.icon} className="text-[15px]" />
                {sourceMeta.label}
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="ingest-folder">
                Destination folder
              </label>
              <Select value={destinationFolder} onValueChange={setDestinationFolder}>
                <SelectTrigger id="ingest-folder" className="h-10 w-full">
                  <SelectValue placeholder="1. INBOX" />
                </SelectTrigger>
                <SelectContent>
                  {destinationFolders.map((folder) => (
                    <SelectItem key={folder} value={folder}>
                      {folder}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="ingest-summary-degree">
                  Summary detail
                </label>
                <span className="text-xs text-muted-foreground">{summaryLabel}</span>
              </div>
              <input
                id="ingest-summary-degree"
                type="range"
                min={1}
                max={5}
                step={1}
                value={summaryDegree}
                onChange={(e) => setSummaryDegree(Number(e.target.value))}
                className="h-10 w-full accent-primary"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={useCustomPrompt}
                onChange={(e) => setUseCustomPrompt(e.target.checked)}
                className="size-4 accent-primary"
              />
              <span>Use custom prompt</span>
            </label>
            {useCustomPrompt && (
              <Textarea
                id="ingest-instruction"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="Optional focus for the summary"
                rows={3}
                className="resize-none"
              />
            )}
          </div>

          {(job || busy) && (
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="mb-3 flex items-center justify-between text-xs">
                <span className="font-medium">Status</span>
                <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
                  {job?.status ?? "queued"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {statuses.map((status, idx) => {
                  const active = activeStatus === status;
                  const complete = activeIndex >= 0 && idx < activeIndex;
                  return (
                    <div
                      key={status}
                      className={cn(
                        "rounded-md border px-2 py-2 text-center text-[11px] leading-tight",
                        complete && "border-primary/35 bg-primary/10 text-foreground",
                        active && "border-primary bg-primary text-primary-foreground",
                        !complete && !active && "border-border text-muted-foreground",
                      )}
                    >
                      {status.replace("_", " ")}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(error || job?.error) && (
            <div className="rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error || job?.error}
            </div>
          )}

          {job?.status === "done" && (
            <div className="rounded-lg border border-border bg-background p-3">
              <p className="text-sm">{job.answer || "Captured."}</p>
              {citations.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {citations.map((citation) => {
                    const href = obsidianUrl(props.vaultPath, citation.path, citation.title);
                    return (
                      <button
                        type="button"
                        key={citation.number}
                        disabled={!href}
                        onClick={() => href && openObsidianLink(href)}
                        className="inline-flex max-w-full cursor-pointer items-center gap-2 rounded-full border border-border bg-card px-2 py-1 text-left transition-colors hover:border-primary/50 hover:bg-accent disabled:cursor-default disabled:opacity-70"
                      >
                        <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[11px] font-medium leading-none text-foreground/80">
                          {citation.number}
                        </span>
                        <span className="h-5 min-w-0 truncate text-[13px] leading-5">{citation.title}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="ghost" onClick={props.onClose}>
            Close
          </Button>
          <Button onClick={start} disabled={!canSubmit}>
            {busy ? "Starting..." : "Start ingest"}
          </Button>
        </footer>
      </motion.div>
    </motion.div>
  );
}
