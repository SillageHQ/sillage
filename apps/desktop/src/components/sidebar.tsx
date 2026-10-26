import { useLingui as useLinguiReact } from "@lingui/react";
import { t } from "@lingui/core/macro";
import { useRef, useState, type DragEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { ArrowDown, ChevronsUpDown, LogOut, Pause, Play, RotateCcw, Search, Settings as SettingsIcon, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConvoSummary, Folder, UserProfile, View } from "@/App";
import { Icon } from "@/App";
import type { VaultNote } from "@/components/vault-explorer";
import type { UpdateBadgeDetail } from "@/components/update-notifier";
import { VaultExplorer } from "@/components/vault-explorer";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function NavRow(props: { icon: string; label: string; onClick?: () => void; active?: boolean }) {
  return (
    <button
      onClick={props.onClick}
      className={cn(
        "flex w-full select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[14px] text-foreground/90 transition-colors hover:bg-sidebar-accent",
        props.active && "bg-sidebar-accent",
      )}
    >
      <Icon name={props.icon} className="text-[16px] text-muted-foreground" />
      <span className="truncate">{props.label}</span>
    </button>
  );
}

export function VaultSidebar(props: { vaultPath: string; onOpenNote: (note: VaultNote) => void }) {
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col overflow-hidden border-l border-sidebar-border bg-sidebar">
      <div className="flex h-11 shrink-0 items-center px-3">
        <span className="truncate text-[15px] font-semibold tracking-tight text-sidebar-foreground">{t`Vault`}</span>
      </div>
      <VaultExplorer vaultPath={props.vaultPath} onSelect={props.onOpenNote} />
    </aside>
  );
}

export function SectionLabel(props: { label: string; onAdd?: () => void }) {
  
  return (
    <div className="group/sec flex select-none items-center justify-between px-3 pb-1 pt-4">
      <span className="text-[13px] text-muted-foreground">{props.label}</span>
      {props.onAdd && (
        <button
          title={t`New folder`}
          onClick={props.onAdd}
          className="flex size-5 select-none items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/sec:opacity-100"
        >
          <Icon name="plus" className="text-sm" />
        </button>
      )}
    </div>
  );
}

/** Compact relative age, localized through `Intl.RelativeTimeFormat`. */
export function relTime(iso: string, locale: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  if (s < 60) return formatter.format(0, "second");
  if (s < 3600) return formatter.format(-Math.floor(s / 60), "minute");
  if (s < 86400) return formatter.format(-Math.floor(s / 3600), "hour");
  if (s < 604800) return formatter.format(-Math.floor(s / 86400), "day");
  if (s < 2592000) return formatter.format(-Math.floor(s / 604800), "week");
  return formatter.format(-Math.floor(s / 2592000), "month");
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function exportCompanionLog() {
  const destination = await save({
    defaultPath: "sillage-companion-log.txt",
    filters: [{ name: "Text files", extensions: ["txt"] }],
  });
  if (destination) await invoke("export_logs", { destination });
}

export function Sidebar(props: {
  folders: Folder[];
  convos: ConvoSummary[];
  activeId: string | null;
  view: View;
  watcherStatus: string;
  accessToken: string;
  profile: UserProfile | null;
  signingOut: boolean;
  onNew: () => void;
  onNewInFolder: (folderId: string) => void;
  onSelect: (id: string) => void;
  onReview: () => void;
  onArchive: () => void;
  onDelete: (id: string) => void;
  onArchiveConvo: (id: string) => void;
  onMove: (id: string, folderId: string | null) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onNewFolder: (name: string) => void;
  onUpdateFolder: (id: string, patch: { name?: string; icon?: string }) => void;
  onDeleteFolder: (id: string) => void;
  folderEdit: { id: string; name: string } | null;
  onEditFolder: (folder: { id: string; name: string } | null) => void;
  onSearchChats: () => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
  onSignOut: () => void;
  updateBadge: UpdateBadgeDetail | null;
  onOpenUpdate: () => void;
}) {
  
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null); // folder id, or "__loose__"
  const [showAllLoose, setShowAllLoose] = useState(false);
  const [folderMenuOpen, setFolderMenuOpen] = useState<string | null>(null);
  const [convoMenuOpen, setConvoMenuOpen] = useState<string | null>(null);
  const [convoEdit, setConvoEdit] = useState<{ id: string; title: string } | null>(null);
  const cancelConvoEditRef = useRef(false);
  const folderIconChoices = [
    { value: "folder", label: t`Folder` },
    { value: "folder_open", label: t`Open folder` },
    { value: "star", label: t`Favorite` },
    { value: "lightbulb", label: t`Idea` },
    { value: "book", label: t`Book` },
    { value: "code", label: t`Code` },
    { value: "science", label: t`Research` },
    { value: "work", label: t`Work` },
    { value: "archive", label: t`Archive` },
    { value: "photo", label: t`Image` },
    { value: "music_note", label: t`Audio` },
    { value: "palette", label: t`Creative` },
  ] as const;

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const loose = props.convos.filter((c) => !c.folderId);
  const inChat = props.view === "chat";

  // Drop a dragged conversation into a folder (null = loose / top level).
  const dropTo = (folderId: string | null) => (e: DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (id) props.onMove(id, folderId);
    setDragOver(null);
  };

  const saveFolderEdit = () => {
    const edit = props.folderEdit;
    if (!edit) return;
    const name = edit.name.trim();
    if (!name) {
      props.onEditFolder(null);
      return;
    }
    props.onUpdateFolder(edit.id, { name });
  };

  const saveConvoEdit = () => {
    if (cancelConvoEditRef.current) {
      cancelConvoEditRef.current = false;
      setConvoEdit(null);
      return;
    }
    const edit = convoEdit;
    if (!edit) return;
    const title = edit.title.trim();
    setConvoEdit(null);
    if (!title) return;
    void props.onRename(edit.id, title);
  };

  const renderConvo = (c: ConvoSummary) => (
    <ConvoRow
      key={c.id}
      convo={c}
      active={inChat && c.id === props.activeId}
      folders={props.folders}
      onSelect={props.onSelect}
      onDelete={props.onDelete}
      onArchive={props.onArchiveConvo}
      onMove={props.onMove}
      onStartRename={() => {
        cancelConvoEditRef.current = false;
        setConvoEdit({ id: c.id, title: c.title });
      }}
      editing={convoEdit?.id === c.id}
      editTitle={convoEdit?.id === c.id ? convoEdit.title : ""}
      onEditTitleChange={(title) => setConvoEdit({ id: c.id, title })}
      onSaveRename={saveConvoEdit}
      onCancelRename={() => {
        cancelConvoEditRef.current = true;
        setConvoEdit(null);
      }}
      menuOpen={convoMenuOpen === c.id}
      onMenuOpenChange={(open) => setConvoMenuOpen(open ? c.id : null)}
      onOpenMenu={() => setConvoMenuOpen(c.id)}
    />
  );

  const shownLoose = showAllLoose ? loose : loose.slice(0, 8);
  const watcherBusy = props.watcherStatus.includes("⟳") || props.watcherStatus.includes("Starting");
  const watcherPaused = props.watcherStatus.includes("⏸");
  const watcherWarning = props.watcherStatus.includes("⚠") || props.watcherStatus.includes("unavailable");
  const watcherLabel = props.watcherStatus.replace(/^[✓⟳⏸⚠️\s]+/u, "");
  const profileName = props.profile?.name || props.profile?.email?.split("@")[0] || "Sillage account";
  const profileInitials = profileName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "S";

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-r border-sidebar-border bg-sidebar">
      <div className="flex h-11 shrink-0 items-center justify-between px-3">
        <div className="flex min-w-0 items-center gap-2">
          <img src="/sillage-mark.svg" alt="" className="size-6 shrink-0" />
          <span className="truncate text-[15px] font-semibold tracking-tight text-sidebar-foreground">Sillage</span>
        </div>
        <button
          type="button"
          onClick={props.onSearchChats}
          title={t`Search conversations`}
          aria-label={t`Search conversations`}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <Search className="size-4" />
        </button>
      </div>
      {/* nav rows */}
      <div className="flex flex-col gap-0.5 p-2">
        <NavRow
          icon="chat-plus"
          label={t`New chat`}
          onClick={props.onNew}
          active={props.view === "chat" && props.activeId === null}
        />
        <NavRow icon="bulb-2" label={t`Review`} onClick={props.onReview} active={props.view === "review"} />
        <NavRow icon="box-archive-1" label={t`Archive`} onClick={props.onArchive} active={props.view === "archive"} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-2 pb-2">
          <SectionLabel label={t`Folders`} onAdd={() => setAdding("")} />
          {adding !== null && (
            <Input
              autoFocus
              value={adding}
              placeholder={t`Folder name...`}
              className="mb-1 h-8 bg-secondary text-sm"
              onChange={(e) => setAdding(e.target.value)}
              onBlur={() => setAdding(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && adding.trim()) {
                  props.onNewFolder(adding.trim());
                  setAdding(null);
                } else if (e.key === "Escape") setAdding(null);
              }}
            />
          )}

          {props.folders.map((f) => {
            const items = props.convos.filter((c) => c.folderId === f.id);
            const open = !collapsed.has(f.id);
            const over = dragOver === f.id;
            const editing = props.folderEdit?.id === f.id;
            return (
              <div key={f.id}>
                <div
                  onClick={() => toggle(f.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setFolderMenuOpen(f.id);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(f.id);
                  }}
                  onDragLeave={() => setDragOver((d) => (d === f.id ? null : d))}
                  onDrop={dropTo(f.id)}
                  className={cn(
                    "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-sidebar-accent",
                    over && "bg-sidebar-accent ring-1 ring-primary",
                  )}
                >
                  <Icon
                    name="chevron-down"
                    className={cn("text-[10px] text-muted-foreground transition-transform", !open && "-rotate-90")}
                  />
                  <Icon name={f.icon || "folder"} className="text-base text-muted-foreground" />
                  {editing ? (
                    <Input
                      autoFocus
                      value={props.folderEdit?.name ?? ""}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        props.onEditFolder({ id: f.id, name: e.target.value })
                      }
                      onBlur={saveFolderEdit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          saveFolderEdit();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          props.onEditFolder(null);
                        }
                      }}
                      className="h-7 flex-1 bg-transparent px-2 text-[14px]"
                    />
                  ) : (
                    <span className="flex-1 truncate text-[14px] select-none">{f.name}</span>
                  )}
                  <span className="select-none text-[11px] text-muted-foreground group-hover:hidden">{items.length}</span>
                  <DropdownMenu open={folderMenuOpen === f.id} onOpenChange={(open) => setFolderMenuOpen(open ? f.id : null)}>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <button
                        data-folder-menu-trigger
                        title={t`Project settings`}
                        className="flex size-5 select-none items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-background/50 hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100"
                      >
                        <Icon name="menu-meatballs-1" className="text-sm" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuItem onSelect={() => props.onEditFolder({ id: f.id, name: f.name })}>
                        <Icon name="pencil-1" /> {t`Rename`}
                      </DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <Icon name="folder-1" /> {t`Change icon`}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          {folderIconChoices.map((choice) => (
                            <DropdownMenuItem
                              key={choice.value}
                              onSelect={() => props.onUpdateFolder(f.id, { icon: choice.value })}
                            >
                              <Icon name={choice.value} className="text-sm" /> {choice.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => props.onDeleteFolder(f.id)}
                      >
                        <Icon name="trash-3" /> {t`Delete`}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <button
                    type="button"
                    title={t`New chat in project`}
                    aria-label={t`New chat in project`}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onNewInFolder(f.id);
                    }}
                    className="flex size-5 select-none items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-background/50 hover:text-foreground group-hover:opacity-100"
                  >
                    <Icon name="chat-plus" className="text-[14px]" />
                  </button>
                </div>
                {open && (
                  <div className="ml-4 border-l border-sidebar-border pl-1">
                    {items.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground/50">{t`Empty`}</div>
                    ) : (
                      items.map(renderConvo)
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Clavardages (loose) — drop here to remove from any folder */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver("__loose__");
            }}
            onDragLeave={() => setDragOver((d) => (d === "__loose__" ? null : d))}
            onDrop={dropTo(null)}
            className={cn("rounded-md", dragOver === "__loose__" && "ring-1 ring-primary")}
          >
            <SectionLabel label={t`Chats`} />
            {loose.length === 0 ? (
              <div className="px-3 py-1 text-[13px] text-muted-foreground/50">{t`No chats`}</div>
            ) : (
              <>
                {shownLoose.map(renderConvo)}
                {loose.length > 8 && (
                  <button
                    onClick={() => setShowAllLoose((v) => !v)}
                    className="px-3 py-1.5 text-[13px] text-muted-foreground hover:text-foreground"
                  >
                    {showAllLoose ? t`Show less` : t`Show more`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {props.updateBadge && (
        <div className="flex shrink-0 justify-end px-2 pb-2">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t`Open available update`}
                  onClick={props.onOpenUpdate}
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full shadow-sm transition-transform hover:scale-105",
                    props.updateBadge.kind === "fix"
                      ? "bg-emerald-500 text-white hover:bg-emerald-400"
                      : "bg-amber-500 text-black hover:bg-amber-400",
                  )}
                >
                  <ArrowDown className="size-3.5" strokeWidth={2.5} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" align="end" sideOffset={8}>
                <p className="font-medium">Update available</p>
                <p className="text-[11px] text-muted-foreground">Version {props.updateBadge.version}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}

      <div className="flex min-h-13 items-center gap-1 border-t border-sidebar-border px-2 py-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="group/profile flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent"
              aria-label={t`Open account menu`}
            >
              <span className="relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/85 text-[10px] font-semibold text-primary-foreground ring-1 ring-white/10">
                {profileInitials}
                {props.profile?.image && (
                  <img
                    src={props.profile.image}
                    alt=""
                    className="absolute inset-0 size-full object-cover"
                    referrerPolicy="no-referrer"
                    onError={(event) => { event.currentTarget.style.display = "none"; }}
                  />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-sidebar-foreground">
                {profileName}
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/profile:opacity-100 group-data-[state=open]/profile:opacity-100" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-64 rounded-xl p-2 shadow-2xl">
            <div className="flex items-center gap-2.5 px-2 py-2">
              <span className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/85 text-[11px] font-semibold text-primary-foreground">
                {profileInitials}
                {props.profile?.image && (
                  <img src={props.profile.image} alt="" className="absolute inset-0 size-full object-cover" referrerPolicy="no-referrer" />
                )}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{profileName}</p>
                {props.profile?.email && <p className="truncate text-[11px] text-muted-foreground">{props.profile.email}</p>}
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={props.onOpenAccount} className="py-2">
              <User />
              Account
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={props.onOpenSettings} className="py-2">
              <SettingsIcon />
              {t`Settings`}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={props.signingOut} onSelect={props.onSignOut} className="py-2">
              <LogOut />
              {props.signingOut ? t`Signing out…` : t`Sign out`}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="group/companion relative flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t`Companion service`}
                aria-describedby="companion-status-card"
                className="group/companion-trigger flex h-7 w-7 items-center justify-start gap-1.5 overflow-hidden rounded-full border border-sidebar-border bg-sidebar-accent/45 px-[9px] transition-[width,background-color] duration-200 ease-out hover:w-[94px] hover:bg-sidebar-accent focus:w-[94px] data-[state=open]:w-[94px] data-[state=open]:bg-sidebar-accent"
              >
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    watcherWarning ? "bg-destructive" : watcherPaused ? "bg-amber-500" : watcherBusy ? "animate-pulse bg-primary" : "bg-emerald-500",
                  )}
                />
                <span className="whitespace-nowrap text-[11px] font-medium opacity-0 transition-opacity duration-150 group-hover/companion-trigger:opacity-100 group-focus/companion-trigger:opacity-100 group-data-[state=open]/companion-trigger:opacity-100">
                  {t`Companion`}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" sideOffset={8} collisionPadding={8} className="w-72 rounded-md p-3">
              <div id="companion-status-card" role="status">
              <div className="flex gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent text-muted-foreground">
                  <Icon name="bot" className="text-[16px]" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        watcherWarning ? "bg-destructive" : watcherPaused ? "bg-amber-500" : watcherBusy ? "animate-pulse bg-primary" : "bg-emerald-500",
                      )}
                    />
                    <span className="whitespace-nowrap text-[12px] font-medium" title={watcherLabel}>{watcherLabel}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                    {t`Watches your vault and syncs note changes.`}
                  </p>
                  <button
                    type="button"
                    onClick={() => void (watcherPaused || watcherWarning
                      ? invoke("restart_watcher", { token: props.accessToken })
                      : invoke("pause_watcher"))}
                    className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline"
                  >
                    {watcherPaused ? <Play size={13} /> : watcherWarning ? <RotateCcw size={13} /> : <Pause size={13} />}
                    {watcherPaused ? t`Resume sync` : watcherWarning ? t`Restart sync` : t`Pause sync`}
                  </button>
                </div>
              </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </aside>
  );
}

export function ConvoRow(props: {
  convo: ConvoSummary;
  active: boolean;
  folders: Folder[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  onMove: (id: string, folderId: string | null) => void;
  onStartRename: () => void;
  editing: boolean;
  editTitle: string;
  onEditTitleChange: (title: string) => void;
  onSaveRename: () => void;
  onCancelRename: () => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onOpenMenu: () => void;
}) {
  const { i18n } = useLinguiReact();
  const { convo: c } = props;
  return (
    <div
      draggable={!props.editing}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", c.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => {
        if (!props.editing) props.onSelect(c.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        props.onOpenMenu();
      }}
      className={cn(
        "group relative flex cursor-pointer items-center gap-2 rounded-md py-1.5 pl-3 pr-2 hover:bg-sidebar-accent",
        props.active && "bg-sidebar-accent",
      )}
    >
      {props.active && (
        <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary" />
      )}
      {props.editing ? (
        <Input
          autoFocus
          value={props.editTitle}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => props.onEditTitleChange(e.target.value)}
          onBlur={props.onSaveRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              props.onCancelRename();
            }
          }}
          className="h-7 flex-1 bg-transparent px-2 text-[14px]"
        />
      ) : (
        <span className="flex-1 truncate text-[14px] select-none">{c.title}</span>
      )}
      {!props.editing && (
        <span className="shrink-0 select-none text-[11px] text-muted-foreground group-hover:hidden">
          {relTime(c.updatedAt, i18n.locale || "en")}
        </span>
      )}
      <DropdownMenu open={props.menuOpen} onOpenChange={props.onMenuOpenChange}>
        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
          <button
            data-convo-menu-trigger
            className="size-5 shrink-0 select-none items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100"
          >
            <Icon name="menu-meatballs-1" className="text-sm" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={props.onStartRename}>
            <Icon name="pencil-1" /> {t`Rename`}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => props.onArchive(c.id)}>
            <Icon name="box-archive-1" /> {t`Archive chat`}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Icon name="folder-1" /> {t`Move to`}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem disabled={!c.folderId} onSelect={() => props.onMove(c.id, null)}>
                {t`None`}
              </DropdownMenuItem>
              {props.folders.map((f) => (
                <DropdownMenuItem
                  key={f.id}
                  disabled={c.folderId === f.id}
                  onSelect={() => props.onMove(c.id, f.id)}
                >
                  {f.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => props.onDelete(c.id)}>
            <Icon name="trash-3" /> {t`Delete`}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
