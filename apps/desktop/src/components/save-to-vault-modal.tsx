import { useState } from "react";
import { motion } from "motion/react";
import { BookMarked, Check, ExternalLink, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { API_URL as API } from "@/lib/api";

export type VaultDraft = {
  id: string;
  messageId: string;
  conversationId: string;
  title: string;
  targetPath: string;
  content: string;
  rationale: string;
  status: "draft" | "applying" | "applied_pending_sync" | "synced" | "failed" | "stale";
};

export function SaveToVaultModal(props: {
  draft: VaultDraft;
  onClose: () => void;
  onSaved?: (draft: VaultDraft) => void;
  onOpenNote?: (draft: VaultDraft) => void;
}) {
  const [title, setTitle] = useState(props.draft.title);
  const [targetPath, setTargetPath] = useState(props.draft.targetPath);
  const [content, setContent] = useState(props.draft.content);
  const [status, setStatus] = useState(props.draft.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function apply() {
    setBusy(true);
    setError("");
    try {
      const edited = await fetch(`${API}/vault-drafts/${props.draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, targetPath, content }),
      });
      const editedResult = await edited.json().catch(() => ({}));
      if (!edited.ok) throw new Error(editedResult.error || "Could not update the draft.");
      const response = await fetch(`${API}/vault-drafts/${props.draft.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmedCurator: true }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not write the note.");
      setStatus(result.status);
      props.onSaved?.({ ...props.draft, ...result, title, targetPath, content });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not write the note.");
    } finally {
      setBusy(false);
    }
  }

  const applied = status === "synced" || status === "applied_pending_sync";
  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Save to vault"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-8 backdrop-blur-sm"
      onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}
    >
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 5, scale: 0.99 }}
        className="flex h-[min(82vh,780px)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
      >
        <header className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span className="flex size-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
            <BookMarked className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-medium">Save as a new vault note</h2>
            <p className="truncate text-[11px] text-muted-foreground">{props.draft.rationale}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={props.onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </header>

        <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] gap-4 overflow-hidden p-5">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5 text-[11px] text-muted-foreground">
              <span>Title</span>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} disabled={applied || busy} />
            </label>
            <label className="space-y-1.5 text-[11px] text-muted-foreground">
              <span>Vault path</span>
              <Input value={targetPath} onChange={(event) => setTargetPath(event.target.value)} disabled={applied || busy} />
            </label>
          </div>
          <label className="flex min-h-0 flex-col gap-1.5 text-[11px] text-muted-foreground">
            <span>Markdown</span>
            <Textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              disabled={applied || busy}
              className="min-h-0 flex-1 resize-none font-mono text-[12px] leading-5"
            />
          </label>
        </div>

        <footer className="border-t border-border bg-card/40 px-5 py-4">
          {error && <p className="mb-3 text-[12px] text-destructive">{error}</p>}
          {!applied && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5 text-[12px]">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
              <p>Nothing has been written yet. The button below will create exactly one Markdown file at <strong>{targetPath || "the selected vault path"}</strong>.</p>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="text-[12px] text-muted-foreground">
              {status === "synced" && <span className="inline-flex items-center gap-1.5 text-emerald-500"><Check className="size-3.5" /> Created at {targetPath}</span>}
              {status === "applied_pending_sync" && <span className="inline-flex items-center gap-1.5"><Check className="size-3.5" /> Created at {targetPath} · indexing pending</span>}
              {!applied && "Review the path and Markdown before writing."}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={props.onClose}>{applied ? "Close" : "Later"}</Button>
              {applied && props.onOpenNote && <Button onClick={() => props.onOpenNote?.({ ...props.draft, title, targetPath, content, status })}><ExternalLink className="size-3.5" /> View note</Button>}
              {!applied && (
                <Button onClick={() => void apply()} disabled={busy || !title.trim() || !targetPath.trim() || !content.trim()}>
                  {busy && <LoaderCircle className="size-3.5 animate-spin" />} Create note
                </Button>
              )}
            </div>
          </div>
        </footer>
      </motion.div>
    </motion.div>
  );
}
