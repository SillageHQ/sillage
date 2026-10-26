import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { t } from "@lingui/core/macro";
import { motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  FilePenLine,
  FileText,
  FolderKanban,
  Lightbulb,
  Search,
  Sparkles,
  WandSparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { API_URL as API } from "@/lib/api";
import type { VaultNote } from "@/components/vault-explorer";
import type { VaultActionRun } from "@/components/consolidation-review-modal";

export type VaultAction = "organize_folder" | "restructure_note" | "rewrite_note" | "structure_idea";

type ActionDefinition = {
  id: VaultAction;
  title: string;
  description: string;
  icon: LucideIcon;
};

type TreeResponse = { items?: VaultNote[]; folders?: string[] };

export function MagicMenu(props: {
  open: boolean;
  currentNote?: VaultNote | null;
  onClose: () => void;
  onCreated: (run: VaultActionRun) => void;
}) {
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<VaultAction | null>(null);
  const [targetPath, setTargetPath] = useState("");
  const [instruction, setInstruction] = useState("");
  const [ideaText, setIdeaText] = useState("");
  const [destinationFolder, setDestinationFolder] = useState("");
  const [notes, setNotes] = useState<VaultNote[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const actions: ActionDefinition[] = [
    {
      id: "organize_folder",
      title: t`Organize a folder`,
      description: t`Rearrange notes, preserve links, and review every move.`,
      icon: FolderKanban,
    },
    {
      id: "restructure_note",
      title: t`Restructure a note`,
      description: t`Clarify the hierarchy without changing the meaning.`,
      icon: FileText,
    },
    {
      id: "rewrite_note",
      title: t`Rewrite a note`,
      description: t`Improve the writing with a precise instruction.`,
      icon: FilePenLine,
    },
    {
      id: "structure_idea",
      title: t`Structure an idea`,
      description: t`Turn raw thoughts into a durable Markdown note.`,
      icon: Lightbulb,
    },
  ];

  useEffect(() => {
    if (!props.open) return;
    setQuery("");
    setAction(null);
    setTargetPath("");
    setInstruction("");
    setIdeaText("");
    setError("");
    setActiveIndex(0);
    setBusy(false);
    void Promise.all([
      fetch(`${API}/notes/tree`).then((response) => response.json() as Promise<TreeResponse>),
      fetch(`${API}/settings`).then((response) => response.json() as Promise<{ resolvedInboxFolder?: string }>),
    ]).then(([tree, settings]) => {
      setNotes(Array.isArray(tree.items) ? tree.items : []);
      setFolders(Array.isArray(tree.folders) ? tree.folders : []);
      setDestinationFolder(settings.resolvedInboxFolder || "1. INBOX");
    }).catch(() => {
      setNotes([]);
      setFolders([]);
      setDestinationFolder("1. INBOX");
    });
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [props.open]);

  const filteredActions = useMemo(() => {
    const token = query.trim().toLowerCase();
    return token
      ? actions.filter((item) => `${item.title} ${item.description}`.toLowerCase().includes(token))
      : actions;
  }, [query]);

  const targets = useMemo(() => {
    if (!action || action === "structure_idea") return [];
    const items = action === "organize_folder"
      ? folders.map((path) => ({ path, title: path.split("/").pop() || path }))
      : notes.map((note) => ({ path: note.path, title: note.title }));
    const token = query.trim().toLowerCase();
    return (token ? items.filter((item) => `${item.title} ${item.path}`.toLowerCase().includes(token)) : items).slice(0, 40);
  }, [action, folders, notes, query]);

  useEffect(() => setActiveIndex(0), [action, query]);

  function chooseAction(next: VaultAction) {
    setAction(next);
    setQuery("");
    setError("");
    if ((next === "restructure_note" || next === "rewrite_note") && props.currentNote) {
      setTargetPath(props.currentNote.path);
      setQuery(props.currentNote.title);
    }
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  function goBack() {
    setAction(null);
    setQuery("");
    setTargetPath("");
    setError("");
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (action && !busy) goBack();
      else props.onClose();
      return;
    }
    const count = action ? targets.length : filteredActions.length;
    if (event.key === "ArrowDown" && count) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % count);
    } else if (event.key === "ArrowUp" && count) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + count) % count);
    } else if (event.key === "Enter" && document.activeElement === searchRef.current && count) {
      event.preventDefault();
      if (action) {
        const selected = targets[activeIndex] ?? targets[0];
        if (selected) {
          setTargetPath(selected.path);
          setQuery(selected.title);
        }
      } else {
        const selected = filteredActions[activeIndex] ?? filteredActions[0];
        if (selected) chooseAction(selected.id);
      }
    } else if (event.key === "Tab" && dialogRef.current) {
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      )];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!action || busy) return;
    if (action !== "structure_idea" && !targetPath) {
      setError(t`Choose a vault target.`);
      return;
    }
    if (action === "rewrite_note" && !instruction.trim()) {
      setError(t`Add an instruction for the rewrite.`);
      return;
    }
    if (action === "structure_idea" && !ideaText.trim()) {
      setError(t`Write or paste an idea first.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API}/vault/action-runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, targetPath, instruction, ideaText, destinationFolder }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t`The vault action could not be prepared.`);
      props.onCreated(result as VaultActionRun);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t`The vault action could not be prepared.`);
      setBusy(false);
    }
  }

  if (!props.open) return null;
  const selectedAction = actions.find((item) => item.id === action);
  const SelectedActionIcon = selectedAction?.icon;

  return (
    <motion.div
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-x-0 bottom-0 top-[var(--app-titlebar-height)] z-[95] flex items-start justify-center bg-black/65 px-5 pt-[10vh] backdrop-blur-md"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && props.onClose()}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t`Magic menu`}
        initial={{ opacity: 0, y: -10, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -5, scale: 0.99 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        onKeyDown={handleKeyDown}
        className="relative w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-primary/80 to-transparent" />
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          {action ? (
            <button type="button" onClick={goBack} disabled={busy} className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
              <ArrowLeft className="size-4" />
            </button>
          ) : (
            <span className="flex size-8 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
              <WandSparkles className="size-4" />
            </span>
          )}
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-0 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={action === "organize_folder" ? t`Find a folder…` : action && action !== "structure_idea" ? t`Find a note…` : t`Search actions…`}
              className="h-9 w-full border-0 bg-transparent pl-7 pr-2 text-[15px] text-foreground outline-none placeholder:text-muted-foreground/70"
            />
          </div>
          <kbd className="rounded-md border border-border bg-secondary px-2 py-1 text-[10px] text-muted-foreground">Esc</kbd>
          <button type="button" onClick={props.onClose} disabled={busy} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="size-3.5" />
          </button>
        </header>

        {!action ? (
          <div className="p-2">
            <div className="px-2 pb-2 pt-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{t`Vault actions`}</div>
            {filteredActions.map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => chooseAction(item.id)}
                  className={cn("group flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors", index === activeIndex ? "bg-accent" : "hover:bg-accent/55")}
                >
                  <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary text-muted-foreground transition-colors", index === activeIndex && "border-primary/25 bg-primary/8 text-primary")}><Icon className="size-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium">{item.title}</span><span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{item.description}</span></span>
                  <ArrowRight className={cn("size-4 text-muted-foreground transition-transform", index === activeIndex && "translate-x-0.5 text-foreground")} />
                </button>
              );
            })}
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="max-h-[58vh] overflow-y-auto p-4">
              <div className="mb-4 flex items-center gap-3 rounded-lg border border-border bg-card/50 px-3 py-3">
                {SelectedActionIcon && <SelectedActionIcon className="size-4 text-primary" />}
                <div><div className="text-[13px] font-medium">{selectedAction?.title}</div><div className="mt-0.5 text-[11px] text-muted-foreground">{selectedAction?.description}</div></div>
              </div>

              {action !== "structure_idea" && (
                <div className="mb-4">
                  <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">{action === "organize_folder" ? t`Folder` : t`Note`}</label>
                  {targetPath && <div className="mb-2 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/6 px-3 py-2 text-[12px]"><Sparkles className="size-3.5 text-primary" /><span className="truncate">{targetPath}</span></div>}
                  <div className="max-h-44 overflow-y-auto rounded-lg border border-border bg-card/30 p-1">
                    {targets.map((item, index) => (
                      <button key={item.path} type="button" onMouseEnter={() => setActiveIndex(index)} onClick={() => { setTargetPath(item.path); setQuery(item.title); }} className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px]", index === activeIndex ? "bg-accent" : "hover:bg-accent/55")}>
                        {action === "organize_folder" ? <FolderKanban className="size-3.5 text-muted-foreground" /> : <FileText className="size-3.5 text-muted-foreground" />}
                        <span className="min-w-0 flex-1 truncate">{item.title}</span><span className="max-w-64 truncate text-[10px] text-muted-foreground">{item.path}</span>
                      </button>
                    ))}
                    {targets.length === 0 && <div className="px-3 py-5 text-center text-[11px] text-muted-foreground">{t`No matching target`}</div>}
                  </div>
                </div>
              )}

              {action === "structure_idea" && (
                <div className="mb-4 space-y-3">
                  <div><label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">{t`Your idea`}</label><Textarea autoFocus value={ideaText} onChange={(event) => setIdeaText(event.target.value)} placeholder={t`Write or paste the thought you want to keep…`} className="min-h-36 resize-y bg-black/15 text-[13px] leading-5" /></div>
                  <div><label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">{t`Destination folder`}</label><Input value={destinationFolder} onChange={(event) => setDestinationFolder(event.target.value)} list="magic-menu-folders" className="bg-black/15 text-[12px]" /><datalist id="magic-menu-folders">{folders.map((folder) => <option key={folder} value={folder} />)}</datalist></div>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">{action === "rewrite_note" ? t`Rewrite instruction` : t`Optional direction`}</label>
                <Textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder={action === "rewrite_note" ? t`Example: make it more concise and editorial…` : t`Add a preference or constraint…`} className="min-h-20 resize-y bg-black/15 text-[12px]" />
              </div>
              {error && <div role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">{error}</div>}
            </div>
            <footer className="flex items-center justify-between border-t border-border bg-card/30 px-4 py-3">
              <span className="text-[10px] text-muted-foreground">{t`Nothing is written before your review.`}</span>
              <Button type="submit" disabled={busy} className="min-w-32">
                {busy ? <><span className="size-3.5 animate-spin rounded-full border-2 border-current/25 border-t-current" />{t`Analyzing…`}</> : <><WandSparkles className="size-3.5" />{t`Prepare review`}</>}
              </Button>
            </footer>
          </form>
        )}
        {!action && <footer className="flex items-center justify-between border-t border-border px-4 py-2 text-[10px] text-muted-foreground"><span>{t`Navigate with arrows · Enter to select`}</span><span className="flex items-center gap-1.5"><span className="size-1 rounded-full bg-primary/70" />{t`Review required`}</span></footer>}
      </motion.div>
    </motion.div>
  );
}
