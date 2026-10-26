import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "@lingui/core/macro";
import { ChevronRight, FileText, Folder, MessageCirclePlus, Search, ExternalLink, X, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ObsidianMarkdown, type CitationAnchor } from "@/components/obsidian-markdown";
import {
  listLocalVaultNotes,
  readLocalVaultNote,
  type LocalVaultNote,
  type LocalVaultNoteContent,
} from "@/lib/local-vault";

export type VaultNote = LocalVaultNote & {
  anchor?: CitationAnchor;
};

type NoteContent = LocalVaultNoteContent;

function lineOffset(content: string, line: number | null | undefined) {
  if (!line || line <= 1) return 0;
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const newline = content.indexOf("\n", offset);
    if (newline < 0) return content.length;
    offset = newline + 1;
  }
  return offset;
}

function nearestQuoteOffset(content: string, quote: string, expected: number) {
  let best = -1;
  let cursor = 0;
  while (quote && cursor <= content.length) {
    const found = content.indexOf(quote, cursor);
    if (found < 0) break;
    if (best < 0 || Math.abs(found - expected) < Math.abs(best - expected)) best = found;
    cursor = found + 1;
  }
  return best;
}

export function resolveCitationHighlight(data: NoteContent, anchor?: CitationAnchor) {
  if (!anchor) return undefined;
  const expected = anchor.start.offset ?? lineOffset(data.content, anchor.start.line);
  const exact = nearestQuoteOffset(data.content, anchor.quote, expected);
  if (exact >= 0) {
    return {
      start: Math.max(0, exact - data.bodyStartOffset),
      end: Math.max(0, exact + anchor.quote.length - data.bodyStartOffset),
      stale: Boolean(anchor.content_hash && anchor.content_hash !== data.contentHash),
    };
  }
  if (anchor.start.line) {
    const start = lineOffset(data.content, anchor.start.line);
    const end = lineOffset(data.content, (anchor.end.line ?? anchor.start.line) + 1);
    return {
      start: Math.max(0, start - data.bodyStartOffset),
      end: Math.max(0, end - data.bodyStartOffset),
      stale: true,
    };
  }
  return { start: 0, end: 0, stale: true };
}

function propertyValue(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "");
}

type VaultFolder = {
  name: string;
  path: string;
  folders: VaultFolder[];
  notes: VaultNote[];
};

const COLLAPSED_FOLDERS_KEY = "sbVaultCollapsedFolders";

function initialCollapsedFolders() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLLAPSED_FOLDERS_KEY) ?? "[]");
    return new Set<string>(Array.isArray(saved) ? saved.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function buildVaultTree(notes: VaultNote[], folderPaths: string[]): VaultFolder {
  type MutableFolder = Omit<VaultFolder, "folders"> & { children: Map<string, MutableFolder> };
  const root: MutableFolder = { name: "", path: "", children: new Map(), notes: [] };

  const ensureFolder = (folderPath: string) => {
    const segments = folderPath.split(/[\\/]/).filter(Boolean);
    let parent = root;
    for (const segment of segments) {
      const path = parent.path ? `${parent.path}/${segment}` : segment;
      let child = parent.children.get(segment);
      if (!child) {
        child = { name: segment, path, children: new Map(), notes: [] };
        parent.children.set(segment, child);
      }
      parent = child;
    }
    return parent;
  };

  for (const folderPath of folderPaths) ensureFolder(folderPath);
  for (const note of notes) {
    ensureFolder(note.folder).notes.push(note);
  }

  const finalize = (folder: MutableFolder): VaultFolder => ({
    name: folder.name,
    path: folder.path,
    folders: [...folder.children.values()]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      .map(finalize),
    notes: [...folder.notes].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" })),
  });

  return finalize(root);
}

function FolderNode(props: {
  folder: VaultFolder;
  depth: number;
  collapsed: Set<string>;
  searching: boolean;
  onToggle: (path: string) => void;
  onSelect: (note: VaultNote) => void;
}) {
  const closed = !props.searching && props.collapsed.has(props.folder.path);
  return (
    <div>
      <button
        type="button"
        aria-expanded={!closed}
        onClick={() => props.onToggle(props.folder.path)}
        className="flex w-full items-center gap-1 rounded-md py-1.5 pr-2 text-left text-[12px] font-medium text-foreground/85 transition-colors hover:bg-sidebar-accent"
        style={{ paddingLeft: 8 + props.depth * 14 }}
      >
        <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ${closed ? "" : "rotate-90"}`} />
        <Folder className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.7} />
        <span className="truncate">{props.folder.name}</span>
      </button>
      {!closed && (
        <div>
          {props.folder.folders.map((folder) => (
            <FolderNode
              key={folder.path}
              folder={folder}
              depth={props.depth + 1}
              collapsed={props.collapsed}
              searching={props.searching}
              onToggle={props.onToggle}
              onSelect={props.onSelect}
            />
          ))}
          {props.folder.notes.map((note) => (
            <NoteNode key={note.path} note={note} depth={props.depth + 1} onSelect={props.onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

function NoteNode(props: { note: VaultNote; depth: number; onSelect: (note: VaultNote) => void }) {
  return (
    <button
      type="button"
      onClick={() => props.onSelect(props.note)}
      className="flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-[12px] text-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-foreground"
      style={{ paddingLeft: 10 + props.depth * 14 }}
    >
      <FileText className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.7} />
      <span className="truncate">{props.note.title}</span>
    </button>
  );
}

export function VaultExplorer(props: { vaultPath: string; onSelect: (note: VaultNote) => void }) {
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<VaultNote[]>([]);
  const [folderPaths, setFolderPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(initialCollapsedFolders);

  useEffect(() => {
    localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify([...collapsed]));
  }, [collapsed]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const data = await listLocalVaultNotes(props.vaultPath, query);
        if (!cancelled) {
          setNotes(Array.isArray(data.items) ? data.items : []);
          setFolderPaths(Array.isArray(data.folders) ? data.folders : []);
        }
      } catch {
        if (!cancelled) {
          setNotes([]);
          setFolderPaths([]);
          setError("Vault unavailable. Check the selected folder in Settings.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query ? 180 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [props.vaultPath, query]);

  const tree = useMemo(() => buildVaultTree(notes, folderPaths), [folderPaths, notes]);
  const toggleFolder = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative px-2 pb-2">
        <Search className="pointer-events-none absolute left-4 top-2 size-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t`Search vault...`}
          className="h-8 bg-secondary/60 pl-8 text-[12px]"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading && <div className="px-2 py-5 text-center text-[11px] text-muted-foreground">{t`Loading notes...`}</div>}
        {!loading && error && <div className="px-2 py-5 text-center text-[11px] text-muted-foreground">{error}</div>}
        {!loading && !error && notes.length === 0 && folderPaths.length === 0 && <div className="px-2 py-5 text-center text-[11px] text-muted-foreground">{t`No notes found`}</div>}
        {!loading && tree.folders.map((folder) => (
          <FolderNode
            key={folder.path}
            folder={folder}
            depth={0}
            collapsed={collapsed}
            searching={Boolean(query.trim())}
            onToggle={toggleFolder}
            onSelect={props.onSelect}
          />
        ))}
        {!loading && tree.notes.map((note) => <NoteNode key={note.path} note={note} depth={0} onSelect={props.onSelect} />)}
      </div>
    </div>
  );
}

export function NotePreview(props: {
  vaultPath: string;
  note: VaultNote;
  onChat: (note: VaultNote) => void;
  onOpenObsidian: (note: VaultNote) => void;
  onClose?: () => void;
}) {
  const [noteContent, setNoteContent] = useState<NoteContent | null>(null);
  const [loading, setLoading] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const highlight = noteContent ? resolveCitationHighlight(noteContent, props.note.anchor) : undefined;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    readLocalVaultNote(props.vaultPath, props.note.path)
      .then((data) => !cancelled && setNoteContent({
        content: data.content ?? "",
        body: data.body ?? data.content ?? "",
        frontmatter: data.frontmatter && typeof data.frontmatter === "object" ? data.frontmatter : {},
        tags: Array.isArray(data.tags) ? data.tags : [],
        bodyStartOffset: Number(data.bodyStartOffset ?? 0),
        contentHash: data.contentHash ?? "",
      }))
      .catch(() => !cancelled && setNoteContent(null))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [props.note.path, props.vaultPath]);

  useEffect(() => {
    if (!noteContent || !props.note.anchor) return;
    const frame = window.requestAnimationFrame(() => {
      contentRef.current?.querySelector("[data-citation-highlight]")?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [noteContent, props.note.anchor]);

  const properties = noteContent ? Object.entries(noteContent.frontmatter) : [];

  return (
    <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto scroll-smooth bg-[radial-gradient(circle_at_top,oklch(0.25_0.018_260/0.3),transparent_38%)]">
      <div className="sticky top-0 z-10 border-b border-border/70 bg-card/90 px-8 py-5 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-3xl items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="truncate font-mono text-[10px] tracking-wide text-muted-foreground">{props.note.path}</div>
            <h1 className="mt-1 truncate text-[22px] font-semibold tracking-[-0.025em]">{props.note.title}</h1>
            {props.note.anchor?.start.line && (
              <div className="mt-1 text-[11px] text-primary/85">
                Passage cité · lignes {props.note.anchor.start.line}{props.note.anchor.end.line && props.note.anchor.end.line !== props.note.anchor.start.line ? `–${props.note.anchor.end.line}` : ""}
              </div>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" onClick={() => props.onOpenObsidian(props.note)}>
              <ExternalLink className="size-3.5" /> {t`Open in Obsidian`}
            </Button>
            <Button size="sm" onClick={() => props.onChat(props.note)}>
              <MessageCirclePlus className="size-3.5" /> {t`Chat with this note`}
            </Button>
            {props.onClose && (
              <Button variant="ghost" size="icon" onClick={props.onClose} title={t`Close`} aria-label={t`Close`}>
                <X className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl px-8 py-8">
        {loading && <div className="py-12 text-center text-sm text-muted-foreground">{t`Loading note...`}</div>}
        {!loading && !noteContent && <div className="py-12 text-center text-sm text-muted-foreground">Note unavailable.</div>}
        {!loading && noteContent && (
          <>
            {properties.length > 0 && (
              <details className="group mb-5 rounded-xl border border-border/70 bg-background/35 open:bg-background/55">
                <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground">
                  <Tags className="size-3.5 text-primary/80" />
                  Propriétés
                  {noteContent.tags.length > 0 && (
                    <span className="ml-1 flex min-w-0 flex-wrap gap-1.5">
                      {noteContent.tags.slice(0, 4).map((tag) => <span key={tag} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">#{tag}</span>)}
                    </span>
                  )}
                  <ChevronRight className="ml-auto size-3.5 transition-transform group-open:rotate-90" />
                </summary>
                <dl className="grid grid-cols-[minmax(100px,0.35fr)_1fr] gap-x-4 gap-y-2 border-t border-border/60 px-4 py-3 text-[12px]">
                  {properties.map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt className="truncate text-muted-foreground">{key}</dt>
                      <dd className="min-w-0 break-words text-foreground/85">{propertyValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
            {highlight?.stale && (
              <div className="mb-4 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-200/80">
                La note a changé depuis cette citation ; le passage le plus proche est affiché.
              </div>
            )}
            <article className="note-reading-surface rounded-2xl border border-border/70 bg-card/55 px-8 py-7 shadow-[0_24px_80px_-48px_rgba(0,0,0,0.9)]">
              <ObsidianMarkdown
                highlight={highlight && highlight.end > highlight.start ? { start: highlight.start, end: highlight.end } : undefined}
              >
                {noteContent.body}
              </ObsidianMarkdown>
            </article>
          </>
        )}
      </div>
    </div>
  );
}
