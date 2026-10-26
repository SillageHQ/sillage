import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { t } from "@lingui/core/macro";
import { FileText, FileUp, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { listLocalVaultNotes } from "@/lib/local-vault";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ChatAttachment, ComposerDraftState, ConversationMode, Folder } from "@/App";
import type { NoteChange } from "@/components/change-diff-modal";
import type { VaultNote } from "@/components/vault-explorer";
import { ConversationModelSelector, Icon, ModeSelector, ProjectSelector, SLASH_COMMANDS, type ComposerPreset, type NoteHit, type SlashCommand } from "@/App";

export function Composer(props: {
  busy: boolean;
  onSend: (q: string, mentions: string[], attachments?: ChatAttachment[]) => void;
  centered?: boolean;
  landing?: boolean;
  preset?: ComposerPreset;
  folders: Folder[];
  projectId: string | null;
  onProjectChange: (folderId: string | null) => void;
  mode: ConversationMode;
  onModeChange: (mode: ConversationMode) => void;
  vaultPath: string;
  changes?: NoteChange[];
  onOpenChanges?: () => void;
  initialNote?: VaultNote | null;
  draft: ComposerDraftState;
  onDraftChange: (draft: ComposerDraftState) => void;
}) {
  
  const [q, setQ] = useState(props.draft.text);
  const [mentions, setMentions] = useState<string[]>(props.draft.mentions);
  const [hits, setHits] = useState<NoteHit[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [slashToken, setSlashToken] = useState<string | null>(null);
  const [activeHitIndex, setActiveHitIndex] = useState(0);
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);
  const [attachments, setAttachments] = useState<ChatAttachment[]>(props.draft.attachments);
  const [attachmentError, setAttachmentError] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hitItemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const slashItemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    props.onDraftChange({ text: q, mentions, attachments });
  }, [q, mentions, attachments]);

  useEffect(() => {
    if (!props.preset?.version) return;
    setQ(props.preset.text);
    setMentions([]);
	    setToken(null);
	    setSlashToken(null);
	    setActiveHitIndex(0);
	    setActiveSlashIndex(0);
	    requestAnimationFrame(() => {
      ref.current?.focus();
      if (ref.current) {
        ref.current.selectionStart = props.preset?.text.length ?? 0;
        ref.current.selectionEnd = props.preset?.text.length ?? 0;
        ref.current.style.height = "auto";
        ref.current.style.height = `${ref.current.scrollHeight}px`;
      }
    });
  }, [props.preset?.text, props.preset?.version]);

  useEffect(() => {
    if (!props.initialNote) return;
    setMentions([props.initialNote.path]);
    setQ(t`Tell me about this note: ${props.initialNote.title}`);
    requestAnimationFrame(() => ref.current?.focus());
  }, [props.initialNote]);

  useEffect(() => {
    if (token === null) {
      setHits([]);
      return;
    }
    const id = setTimeout(async () => {
      try {
        const result = await listLocalVaultNotes(props.vaultPath, token);
        setHits(result.items.slice(0, 20));
      } catch {
        setHits([]);
      }
    }, 150);
    return () => clearTimeout(id);
  }, [props.vaultPath, token]);

  function onChange(v: string) {
    setQ(v);
    const beforeCursor = v.slice(0, ref.current?.selectionStart ?? v.length);
    const m = beforeCursor.match(/@([^\s@]*)$/);
    const slash = beforeCursor.match(/^\/([^\s]*)$/);
    setToken(m ? m[1] : null);
    setSlashToken(slash ? slash[1].toLowerCase() : null);
  }

	  function pick(note: NoteHit) {
	    setQ((cur) => cur.replace(/@([^\s@]*)$/, `@${note.title} `));
	    setMentions((ms) => (ms.includes(note.title) ? ms : [...ms, note.title]));
	    setToken(null);
	    setActiveHitIndex(0);
	    ref.current?.focus();
	  }

  function pickSlash(command: SlashCommand) {
	    setQ(command.template);
	    setToken(null);
	    setSlashToken(null);
	    setActiveSlashIndex(0);
	    requestAnimationFrame(() => {
      ref.current?.focus();
      if (ref.current) {
        ref.current.selectionStart = command.template.length;
        ref.current.selectionEnd = command.template.length;
        ref.current.style.height = "auto";
        ref.current.style.height = `${ref.current.scrollHeight}px`;
      }
    });
  }

  function submit() {
    if ((!q.trim() && attachments.length === 0) || props.busy) return;
    props.onSend(q.trim() || t`Please analyze the attached files.`, mentions, attachments);
    props.onDraftChange({ text: "", mentions: [], attachments: [] });
    setQ("");
	    setMentions([]);
	    setAttachments([]);
	    setAttachmentError("");
	    setToken(null);
	    setSlashToken(null);
	    setActiveHitIndex(0);
	    setActiveSlashIndex(0);
	    if (ref.current) ref.current.style.height = "auto";
	  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setAttachmentError("");
    const availableSlots = Math.max(0, 5 - attachments.length);
    const selected = [...files].slice(0, availableSlots);
    if (selected.some((file) => file.size > 1_000_000)) {
      setAttachmentError(t`Files must be smaller than 1 MB.`);
    }
    const loaded = await Promise.all(
      selected
        .filter((file) => file.size <= 1_000_000)
        .map(async (file) => ({
          name: file.name,
          type: file.type || "text/plain",
          size: file.size,
          content: await file.text(),
        })),
    );
    setAttachments((current) => {
      const names = new Set(current.map((attachment) => attachment.name));
      return [...current, ...loaded.filter((attachment) => !names.has(attachment.name))].slice(0, 5);
    });
    if (files.length > availableSlots) setAttachmentError(t`You can attach up to 5 files.`);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

	  const slashCommands =
	    slashToken === null
	      ? []
	      : SLASH_COMMANDS.filter((command) => {
	          const haystack = `${command.command} ${command.title} ${command.description}`.toLowerCase();
	          return haystack.includes(slashToken);
	        });

	  useEffect(() => {
	    setActiveHitIndex(0);
	  }, [token]);

	  useEffect(() => {
	    setActiveSlashIndex(0);
	  }, [slashToken]);

	  useEffect(() => {
	    setActiveHitIndex((idx) => Math.min(idx, Math.max(0, hits.length - 1)));
	  }, [hits.length]);

	  useEffect(() => {
	    setActiveSlashIndex((idx) => Math.min(idx, Math.max(0, slashCommands.length - 1)));
	  }, [slashCommands.length]);

	  useEffect(() => {
	    if (token === null) return;
	    hitItemRefs.current[activeHitIndex]?.scrollIntoView({ block: "nearest" });
	  }, [activeHitIndex, token]);

	  useEffect(() => {
	    if (slashToken === null) return;
	    slashItemRefs.current[activeSlashIndex]?.scrollIntoView({ block: "nearest" });
	  }, [activeSlashIndex, slashToken]);

	  function handleComposerKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
	    if (slashToken !== null && slashCommands.length > 0) {
	      if (e.key === "ArrowDown") {
	        e.preventDefault();
	        setActiveSlashIndex((idx) => (idx + 1) % slashCommands.length);
	        return;
	      }
	      if (e.key === "ArrowUp") {
	        e.preventDefault();
	        setActiveSlashIndex((idx) => (idx - 1 + slashCommands.length) % slashCommands.length);
	        return;
	      }
	      if (e.key === "Enter") {
	        e.preventDefault();
	        pickSlash(slashCommands[activeSlashIndex] ?? slashCommands[0]);
	        return;
	      }
	      if (e.key === "Escape") {
	        e.preventDefault();
	        setSlashToken(null);
	        return;
	      }
	    }

	    if (token !== null && hits.length > 0) {
	      if (e.key === "ArrowDown") {
	        e.preventDefault();
	        setActiveHitIndex((idx) => (idx + 1) % hits.length);
	        return;
	      }
	      if (e.key === "ArrowUp") {
	        e.preventDefault();
	        setActiveHitIndex((idx) => (idx - 1 + hits.length) % hits.length);
	        return;
	      }
	      if (e.key === "Enter") {
	        e.preventDefault();
	        pick(hits[activeHitIndex] ?? hits[0]);
	        return;
	      }
	      if (e.key === "Escape") {
	        e.preventDefault();
	        setToken(null);
	        return;
	      }
	    }

	    if (e.key === "Enter" && !e.shiftKey) {
	      e.preventDefault();
	      submit();
	    }
	  }

	  return (
    <div
      className={cn(
        "relative w-full overflow-visible rounded-2xl border border-border bg-card p-0",
        props.centered && "max-w-5xl",
        props.landing && "rounded-[22px] bg-card/90 shadow-xl shadow-black/10",
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5 text-[12px] text-muted-foreground">
        <ProjectSelector
          folders={props.folders}
          projectId={props.projectId}
          disabled={props.busy}
          onChange={props.onProjectChange}
        />
        {props.landing && (
          <>
            <span className="size-1 rounded-full bg-border" />
            <span className="flex items-center gap-1.5 px-1">
              <Icon name="bot" className="text-[14px]" />
              {t`Local memory`}
            </span>
          </>
        )}
      </div>
      <div className={cn("p-3", props.landing && "p-4 pb-3")}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        accept=".txt,.md,.markdown,.json,.csv,.tsv,.js,.jsx,.ts,.tsx,.py,.rs,.go,.java,.c,.cpp,.h,.html,.css,.xml,.yaml,.yml,.toml,.log,text/*"
        onChange={(event) => void addFiles(event.target.files)}
      />
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((attachment) => (
            <span
              key={attachment.name}
              className="inline-flex max-w-52 items-center gap-1.5 rounded-md border border-border bg-secondary/70 py-1 pl-2 pr-1 text-[11px] text-foreground/85"
            >
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{attachment.name}</span>
              <button
                type="button"
                aria-label={t`Remove attachment`}
                onClick={() => setAttachments((current) => current.filter((item) => item.name !== attachment.name))}
                className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {attachmentError && <p className="mb-2 text-[11px] text-destructive">{attachmentError}</p>}
      {mentions.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {mentions.map((m) => (
            <span
              key={m}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary py-0.5 pl-2.5 pr-1 text-xs text-primary"
            >
              @{m}
              <button
                onClick={() => setMentions((ms) => ms.filter((x) => x !== m))}
                className="text-muted-foreground hover:text-foreground"
              >
                <Icon name="xmark" className="text-[10px]" />
              </button>
            </span>
          ))}
        </div>
      )}
	      {slashToken !== null && slashCommands.length > 0 && (
	        <div className="absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-30 max-h-64 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-xl">
	          {slashCommands.map((command, index) => (
		            <button
		              key={command.id}
		              type="button"
		              ref={(node) => {
		                slashItemRefs.current[index] = node;
		              }}
		              aria-selected={index === activeSlashIndex}
		              onClick={() => pickSlash(command)}
	              onMouseEnter={() => setActiveSlashIndex(index)}
	              className={cn(
	                "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-accent",
	                index === activeSlashIndex && "bg-accent",
	              )}
	            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                <Icon name={command.icon} className="text-[16px]" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="text-[13px] font-medium">{command.title}</span>
                  <code className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {command.command}
                  </code>
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">{command.description}</span>
              </span>
            </button>
          ))}
        </div>
      )}
	      {token !== null && hits.length > 0 && (
	        <div className="absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-30 max-h-64 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-xl">
	          {hits.map((h, index) => (
		            <button
		              key={h.title}
		              ref={(node) => {
		                hitItemRefs.current[index] = node;
		              }}
		              aria-selected={index === activeHitIndex}
		              onClick={() => pick(h)}
	              onMouseEnter={() => setActiveHitIndex(index)}
	              className={cn(
	                "flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left hover:bg-accent",
	                index === activeHitIndex && "bg-accent",
	              )}
	            >
              <span className="text-[13px]">{h.title}</span>
              {h.path && <span className="text-[11px] text-muted-foreground">{h.path}</span>}
            </button>
          ))}
        </div>
      )}
      <Textarea
        ref={ref}
        value={q}
        rows={1}
        autoFocus
        placeholder={props.landing ? t`Ask your second brain anything...` : t`Ask a question... (/ for commands, @ to cite a note)`}
        className={cn(
          "max-h-52 min-h-0 resize-none border-0 bg-transparent p-0 text-[15px] shadow-none focus-visible:ring-0 dark:bg-transparent",
          props.landing && "min-h-12 text-[16px]",
        )}
        onChange={(e) => {
          onChange(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = `${e.target.scrollHeight}px`;
        }}
	        onKeyDown={handleComposerKeyDown}
      />
      <div className="mt-2 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={props.busy}
                aria-label={t`Add to chat`}
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
              >
                <Plus className="size-[18px]" strokeWidth={1.7} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="min-w-52">
              <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
                <FileUp className="size-4" />
                <span>{t`Add files`}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setQ((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}@`);
                  setToken("");
                  requestAnimationFrame(() => ref.current?.focus());
                }}
              >
                <FileText className="size-4" />
                <span>{t`Reference a vault note`}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ModeSelector mode={props.mode} disabled={props.busy} onChange={props.onModeChange} />
        </div>
        <div className="flex items-center gap-2">
          {props.changes && props.changes.length > 0 && (
            <button
              type="button"
              onClick={props.onOpenChanges}
              className="flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-[11px] transition-colors hover:bg-secondary"
            >
              <span className="text-emerald-500">+{props.changes.reduce((sum, change) => sum + change.addedLines, 0)}</span>
              <span className="text-destructive">−{props.changes.reduce((sum, change) => sum + change.removedLines, 0)}</span>
              <span className="text-muted-foreground">{t`View changes`}</span>
            </button>
          )}
          <ConversationModelSelector disabled={props.busy} />
          <Button
            size="icon"
            className="size-8 rounded-full"
            onClick={submit}
            disabled={props.busy || (!q.trim() && attachments.length === 0)}
          >
            <Icon name="arrow-upward" />
          </Button>
        </div>
      </div>
      </div>
    </div>
  );
}
