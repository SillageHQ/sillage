import {
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { t } from "@lingui/core/macro";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import {
  Archive as ArchiveIcon,
  ArrowLeft,
  ArrowUp,
  BrainCircuit,
  Bot,
  BookOpen,
  Briefcase,
  ChevronDown,
  ChevronsUpDown,
  Check,
  CircleHelp,
  Code2,
  ExternalLink,
  FileAudio,
  FileImage,
  FilePenLine,
  FilePlus2,
  FileText,
  FlaskConical,
  Folder,
  FolderOpen,
  House,
  Lightbulb,
  Link,
  MessageCircle,
  MessageCirclePlus,
  MoreVertical,
  Palette,
  PanelLeft,
  PanelRight,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Star,
  Settings as SettingsIcon,
  Trash2,
  User,
  Video,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { shortcutFromEvent } from "@/lib/keybindings";
import { API_URL as API } from "@/lib/api";
const LOCAL_WEB_API = "http://127.0.0.1:8787";
import {
  buildMemoryPresets,
  closestMemoryPreset,
  FINEST_INGESTION_MODEL_IDS,
  type MemoryModel,
} from "@/lib/memory-presets";
import {
  CLAUDE_MEMORY_PROFILES,
  findClaudeMemoryProfile,
} from "@/lib/claude-memory-profiles";
import type { NoteChange } from "@/components/change-diff-modal";
import type { VaultNote } from "@/components/vault-explorer";
import type { CitationAnchor } from "@/components/obsidian-markdown";
import { ConversationPreviewModal, NotePreviewModal } from "@/components/preview-modals";
import { Composer } from "@/components/composer";
import { exportCompanionLog, Sidebar, VaultSidebar, wait } from "@/components/sidebar";
import { Thread } from "@/components/chat-thread";
import { IngestModal } from "@/components/ingest-modal";
import { Archive, Review } from "@/components/workspace-panes";
import { SettingsModal } from "@/components/settings-modal";
import { uiActions, useUiStore } from "@/state/ui-store";
import { conversationActions, createConversationTab, TABS_STORAGE_KEY, useConversationStore } from "@/state/conversation-store";
import { useAccountProfileQuery } from "@/queries/account";
import { ChatSearchModal } from "@/components/chat-search-modal";
import type { VaultDraft } from "@/components/save-to-vault-modal";
import { ConsolidationReviewModal, type VaultActionRun } from "@/components/consolidation-review-modal";
import { MagicMenu } from "@/components/magic-menu";
import { useAccountSession } from "@/components/account-gate";
import {
  REOPEN_UPDATE_TOAST_EVENT,
  UPDATE_BADGE_VISIBILITY_EVENT,
  type UpdateBadgeDetail,
} from "@/components/update-notifier";
import { i18n } from "./i18n";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const MIN_AGENT_LOADING_MS = 1200;

export type Fact = {
  fact: string;
  valid_at: string | null;
  source_type?: "note" | "chat" | "external" | "web_page";
  source_title?: string | null;
  note_title: string | null;
  note_path: string | null;
  conversation_id?: string | null;
  citation_number?: number;
  chunk_id?: string | null;
  heading_path?: string | null;
  start_line?: number | null;
  end_line?: number | null;
  citation_anchor?: CitationAnchor;
};
export type KnowledgeSource = {
  origin: "user_authored" | "user_message" | "assistant_synthesis" | "external_source" | "conversation" | "model_knowledge";
  authority: "low" | "medium" | "high";
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
export type MessageAction = {
  type: "open_conversation";
  conversation_id: string;
  title: string;
} | {
  type: "tool_call";
  name: string;
  label: string;
  status: "completed" | "error" | "running" | "pending";
  input?: Record<string, unknown>;
  summary?: string;
  results?: Array<{ title?: string; url: string; excerpt?: string }>;
};
export type ChatError = {
  code?: string;
  provider?: string;
  title?: string;
  message?: string;
  actionUrl?: string;
  retryable?: boolean;
};
export type Msg = {
  id?: string;
  role: "user" | "brain";
  text: string;
  facts?: Fact[];
  sources?: KnowledgeSource[];
  actions?: MessageAction[];
  error?: ChatError;
  createdAt?: string;
  pendingSince?: string;
  noteChanges?: NoteChange[];
  vaultDrafts?: VaultDraft[];
};
export type Folder = { id: string; name: string; icon: string };
export type ConversationMode = "read" | "curator";
export type ChatAttachment = { name: string; type: string; size: number; content: string };
export type ComposerDraftState = { text: string; mentions: string[]; attachments: ChatAttachment[] };
export type ConvoSummary = { id: string; title: string; updatedAt: string; folderId: string | null; mode: ConversationMode };
export type ConversationTab = {
  key: string;
  conversationId: string | null;
  title: string;
  messages: Msg[];
  busy: boolean;
  loading: boolean;
  projectId: string | null;
  mode: ConversationMode;
  draftNote: VaultNote | null;
  composerDraft: ComposerDraftState;
  version: number;
};
export type TabWorkspace = { tabs: ConversationTab[]; activeKey: string | null; home: ConversationTab };
type KeybindingAction = "magicMenu" | "newChat" | "nextTab" | "previousTab" | "toggleLeftSidebar" | "toggleRightSidebar";
export type Keybindings = Record<KeybindingAction, string>;
export type NoteHit = { title: string; path: string | null };
type VaultSourceType = "manual" | "icloud" | "google_drive" | "kdrive" | "obsidian_sync" | "cloud_connector";
export type Settings = {
  archiveAutoPurge: boolean;
  archivePurgeDays: number;
  vaultPath: string;
  vaultRootPath: string;
  vaultSourceType: VaultSourceType;
  vaultSourceLabel: string;
  syncStatus: string;
  lastSyncCheckAt: string | null;
  locale: string;
  inboxFolder: string;
  resolvedInboxFolder: string;
  inboxFolderAvailable: boolean;
  consolidationTrigger: "off" | "ask_on_close" | "draft_automatically";
  defaultModel: string;
  claudeModel: string;
  claudeIngestionModel: string;
  claudeEmbeddingModel: string;
  ingestionModel: string;
  ingestionProvider: "openrouter" | "claude-code";
  embeddingModel: string;
  memoryPresetLevel: number;
  rerankModel: string;
  hasOpenRouterApiKey: boolean;
};
export type ConversationModelOption = MemoryModel;
export const CLAUDE_CONVERSATION_MODELS: ConversationModelOption[] = [
  { id: "default", name: "Claude Code default" },
  { id: "sonnet", name: "Claude Sonnet" },
  { id: "opus", name: "Claude Opus" },
  { id: "fable", name: "Claude Fable" },
];
type BillingPlan = "personal" | "deep" | "archive";
type UserBilling = { active: boolean; plan: BillingPlan | null; status: string | null; indexedNotes: number; noteLimit: number; nextBilledAt: string | null; canceledAt: string | null };
export type UserProfile = { id: string; name: string; email: string; image: string | null; billing?: UserBilling };
export type View = "chat" | "review" | "archive";
export type ComposerPreset = { text: string; version: number };
export type SlashCommand = {
  id: string;
  command: string;
  title: string;
  description: string;
  icon: string;
  template: string;
};

const KEYBINDINGS_STORAGE_KEY = "sbKeybindings";
type LocalModelTask = { id: string; kind: string; payload: unknown; leaseId: string };
const DEFAULT_KEYBINDINGS: Keybindings = {
  magicMenu: "Mod+K",
  newChat: "Mod+N",
  nextTab: "Control+Tab",
  previousTab: "Control+Shift+Tab",
  toggleLeftSidebar: "Mod+Shift+L",
  toggleRightSidebar: "Mod+Shift+R",
};
const KEYBINDING_ACTIONS: Array<{
  id: KeybindingAction;
  title: string;
  description: string;
}> = [
  { id: "magicMenu", title: t`Magic menu`, description: t`Open vault actions from anywhere in Sillage.` },
  { id: "newChat", title: "New chat", description: "Return to the home composer." },
  { id: "nextTab", title: "Next tab", description: "Activate the next open conversation." },
  { id: "previousTab", title: "Previous tab", description: "Activate the previous open conversation." },
  { id: "toggleLeftSidebar", title: "Toggle left sidebar", description: "Show or hide conversations and projects." },
  { id: "toggleRightSidebar", title: "Toggle vault sidebar", description: "Show or hide the Obsidian vault." },
];

function loadKeybindings(): Keybindings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEYBINDINGS_STORAGE_KEY) || "{}") as Partial<Keybindings>;
    return Object.fromEntries(
      (Object.keys(DEFAULT_KEYBINDINGS) as KeybindingAction[]).map((action) => [
        action,
        typeof saved[action] === "string" ? saved[action] : DEFAULT_KEYBINDINGS[action],
      ]),
    ) as Keybindings;
  } catch {
    return { ...DEFAULT_KEYBINDINGS };
  }
}

async function completeLocalModelTask(task: LocalModelTask) {
  let result: unknown;
  let error: string | undefined;
  try {
    result = await invoke("execute_local_model_task", { kind: task.kind, payload: task.payload });
  } catch (reason) {
    error = reason instanceof Error ? reason.message : String(reason);
  }
  await fetch(`${API}/v1/local-model-tasks/${task.id}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leaseId: task.leaseId, ...(error ? { error } : { result }) }),
  });
}

export const VAULT_SOURCE_LABELS: Record<VaultSourceType, string> = {
  manual: "Manual folder",
  icloud: "iCloud Drive",
  google_drive: "Google Drive",
  kdrive: "kDrive",
  obsidian_sync: "Obsidian Sync",
  cloud_connector: "Cloud connector",
};

/** Beta feature flags — flip on when the corresponding backend is ready. */
export const BETA = {
  /** Cloud vault sources (iCloud, Google Drive, etc.) */
  cloudVaultSources: false,
  /** Homepage / modal capture (needs external API) */
  captureContent: false,
} as const;

export const AVAILABLE_VAULT_SOURCES: VaultSourceType[] = BETA.cloudVaultSources
  ? (Object.keys(VAULT_SOURCE_LABELS) as VaultSourceType[])
  : ["manual"];

export const SLASH_COMMANDS: SlashCommand[] = [
  ...(BETA.captureContent
    ? [{
        id: "capture",
        command: "/capture",
        title: "Capture URL",
        description: "Ingest a web page into Obsidian Inbox",
        icon: "link",
        template: "/capture ",
      } satisfies SlashCommand]
    : []),
  {
    id: "search",
    command: "/search",
    title: "Search notes",
    description: "Find vault notes by title or content",
    icon: "search",
    template: "/search ",
  },
  {
    id: "read",
    command: "/read",
    title: "Read note",
    description: "Read and summarize a specific note",
    icon: "article",
    template: "/read ",
  },
  {
    id: "open",
    command: "/open",
    title: "Open note",
    description: "Show an Obsidian button for a note",
    icon: "open-in-new",
    template: "/open ",
  },
  {
    id: "note",
    command: "/note",
    title: "Create note",
    description: "Create a new note in the vault",
    icon: "note-add",
    template: "/note ",
  },
  {
    id: "update",
    command: "/update",
    title: "Update note",
    description: "Append to or edit an existing note",
    icon: "edit-note",
    template: "/update ",
  },
  {
    id: "conversation",
    command: "/conversation",
    title: "Open conversation",
    description: "Find a previous chat",
    icon: "chat",
    template: "/conversation ",
  },
];

export function isVaultSourceType(value: unknown): value is VaultSourceType {
  return (
    value === "manual" ||
    value === "icloud" ||
    value === "google_drive" ||
    value === "kdrive" ||
    value === "obsidian_sync" ||
    value === "cloud_connector"
  );
}

export function normalizeSettings(raw: Partial<Settings>): Settings {
  const sourceType = isVaultSourceType(raw.vaultSourceType) ? raw.vaultSourceType : "manual";
  const root = raw.vaultRootPath || raw.vaultPath || "";
  return {
    archiveAutoPurge: Boolean(raw.archiveAutoPurge),
    archivePurgeDays: Number(raw.archivePurgeDays || 30),
    vaultPath: root,
    vaultRootPath: root,
    vaultSourceType: sourceType,
    vaultSourceLabel: raw.vaultSourceLabel || VAULT_SOURCE_LABELS[sourceType],
    syncStatus: raw.syncStatus || "unknown",
    lastSyncCheckAt: raw.lastSyncCheckAt || null,
    locale: raw.locale || "en",
    inboxFolder: raw.inboxFolder || "",
    resolvedInboxFolder: raw.resolvedInboxFolder || "",
    inboxFolderAvailable: raw.inboxFolderAvailable !== false,
    consolidationTrigger: raw.consolidationTrigger === "ask_on_close" || raw.consolidationTrigger === "draft_automatically"
      ? raw.consolidationTrigger
      : "off",
    defaultModel: raw.defaultModel || "deepseek/deepseek-v4-flash",
    claudeModel: raw.claudeModel || "default",
    claudeIngestionModel: raw.claudeIngestionModel || "default",
    claudeEmbeddingModel: raw.claudeEmbeddingModel || "multilingual-e5-small",
    ingestionModel: raw.ingestionModel || "google/gemini-2.5-flash",
    ingestionProvider: raw.ingestionProvider === "claude-code" ? "claude-code" : "openrouter",
    embeddingModel: raw.embeddingModel || "openai/text-embedding-3-small",
    memoryPresetLevel: Math.max(0, Math.min(Number(raw.memoryPresetLevel ?? 2), 4)),
    rerankModel: raw.rerankModel || "cohere/rerank-v3.5",
    hasOpenRouterApiKey: Boolean(raw.hasOpenRouterApiKey),
  };
}

const ICONS: Record<string, LucideIcon> = {
  "arrow-upward": ArrowUp,
  "arrow-left": ArrowLeft,
  "bot": Bot,
  "bolt-2": Zap,
  "box-archive-1": ArchiveIcon,
  "bulb-2": Lightbulb,
  "chevron-down": ChevronDown,
  "chevron-left": PanelLeft,
  "folder-1": Folder,
  "gear-1": SettingsIcon,
  "user": User,
  "home": House,
  "link": Link,
  "article": FileText,
  "audio-file": FileAudio,
  "chat": MessageCircle,
  "chat-plus": MessageCirclePlus,
  "edit-note": FilePenLine,
  "help": CircleHelp,
  "menu-meatballs-1": MoreVertical,
  "note-add": FilePlus2,
  "open-in-new": ExternalLink,
  "pencil-1": Pencil,
  "plus": Plus,
  "search": Search,
  "smart-display": Video,
  "trash-3": Trash2,
  "xmark": X,
  folder: Folder,
  folder_open: FolderOpen,
  star: Star,
  lightbulb: Lightbulb,
  book: BookOpen,
  code: Code2,
  science: FlaskConical,
  work: Briefcase,
  archive: ArchiveIcon,
  photo: FileImage,
  music_note: FileAudio,
  palette: Palette,
};

export function Icon({ name, className }: { name: string; className?: string }) {
  const Glyph = ICONS[name] ?? CircleHelp;
  return (
    <Glyph
      className={cn("size-[1em] shrink-0 text-[16px] select-none", className)}
      strokeWidth={1.75}
      aria-hidden
    />
  );
}

import {
  obsidianUrl,
  openObsidianLink,
  expandToolSlashCommand,
  parseCaptureCommand,
} from "@/components/markdown-renderer";
export default function App() {
  const accessToken = useAccountSession();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [convos, setConvos] = useState<ConvoSummary[]>([]);
  const tabWorkspace = useConversationStore((state) => state.workspace);
  const setTabWorkspace = conversationActions.setWorkspace;
  const activeTab = tabWorkspace.activeKey
    ? tabWorkspace.tabs.find((tab) => tab.key === tabWorkspace.activeKey) ?? tabWorkspace.home
    : tabWorkspace.home;
  const activeId = activeTab.conversationId;
  const messages = activeTab.messages;
  const busy = activeTab.busy;
  const newChatVersion = activeTab.version;
  const selectedProjectId = activeTab.projectId;
  const conversationMode = activeTab.mode;
  const draftNote = activeTab.draftNote;
  const persistedTabsState = JSON.stringify({
    activeKey: tabWorkspace.activeKey,
    tabs: tabWorkspace.tabs.map((tab) => ({
      key: tab.key,
      conversationId: tab.conversationId,
      title: tab.title,
      projectId: tab.projectId,
      mode: tab.mode,
    })),
  });
  const view = useUiStore((state) => state.view);
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const vaultSidebarOpen = useUiStore((state) => state.vaultSidebarOpen);
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const settingsSection = useUiStore((state) => state.settingsSection);
  const ingestOpen = useUiStore((state) => state.ingestOpen);
  const chatSearchOpen = useUiStore((state) => state.chatSearchOpen);
  const magicMenuOpen = useUiStore((state) => state.magicMenuOpen);
  const setView = uiActions.setView;
  const setSidebarOpen = uiActions.setSidebarOpen;
  const setVaultSidebarOpen = uiActions.setVaultSidebarOpen;
  const setSettingsOpen = uiActions.setSettingsOpen;
  const setSettingsSection = uiActions.setSettingsSection;
  const setIngestOpen = uiActions.setIngestOpen;
  const setChatSearchOpen = uiActions.setChatSearchOpen;
  const setMagicMenuOpen = uiActions.setMagicMenuOpen;
  const [vaultActionRun, setVaultActionRun] = useState<VaultActionRun | null>(null);
  const [citationPreviewNote, setCitationPreviewNote] = useState<VaultNote | null>(null);
  const [citationPreviewConversationId, setCitationPreviewConversationId] = useState<string | null>(null);
  const [watcherStatus, setWatcherStatus] = useState("Starting…");
  const { data: profileData } = useAccountProfileQuery(Boolean(accessToken));
  const profile = profileData?.user ?? null;
  const [signingOut, setSigningOut] = useState(false);
  const [updateBadge, setUpdateBadge] = useState<UpdateBadgeDetail | null>(
    import.meta.env.DEV ? { kind: "minor", version: "1.1.0" } : null,
  );
  const [folderEdit, setFolderEdit] = useState<{ id: string; name: string } | null>(null);
  const [locale, setLocale] = useState(() => localStorage.getItem("sbLocale") || "en");
  const [keybindings, setKeybindings] = useState<Keybindings>(loadKeybindings);
  const [vaultPath, setVaultPath] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(localStorage.getItem("sbW")) || 264);
  const [vaultSidebarWidth, setVaultSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem("sbVaultSidebarWidth")) || 280;
    return Math.min(420, Math.max(220, saved));
  });

  useEffect(() => {
    if (!accessToken) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (stopped) return;
      try {
        const response = await fetch(`${API}/v1/local-model-tasks/claim`, { method: "POST" });
        if (response.ok && response.status !== 204) {
          const task = await response.json() as LocalModelTask;
          await completeLocalModelTask(task);
        }
      } catch {
        /* The worker retries while the desktop session is active. */
      }
      if (!stopped) timer = setTimeout(poll, 500);
    };
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [accessToken]);

  useEffect(() => {
    const handleUpdateBadge = (event: Event) => {
      setUpdateBadge((event as CustomEvent<UpdateBadgeDetail | null>).detail);
    };
    window.addEventListener(UPDATE_BADGE_VISIBILITY_EVENT, handleUpdateBadge);
    return () => window.removeEventListener(UPDATE_BADGE_VISIBILITY_EVENT, handleUpdateBadge);
  }, []);

  function updateTab(key: string, update: (tab: ConversationTab) => ConversationTab) {
    setTabWorkspace((current) => ({
      ...current,
      home: key === current.home.key ? update(current.home) : current.home,
      tabs: current.tabs.map((tab) => tab.key === key ? update(tab) : tab),
    }));
  }

  function setActiveTabField<K extends keyof ConversationTab>(
    field: K,
    next: ConversationTab[K] | ((current: ConversationTab[K]) => ConversationTab[K]),
  ) {
    const key = activeTab.key;
    updateTab(key, (tab) => ({
      ...tab,
      [field]: typeof next === "function"
        ? (next as (current: ConversationTab[K]) => ConversationTab[K])(tab[field])
        : next,
    }));
  }

  const setSelectedProjectId = (next: string | null | ((current: string | null) => string | null)) =>
    setActiveTabField("projectId", next);
  const setConversationMode = (next: ConversationMode) => setActiveTabField("mode", next);

  function cycleTab(direction: 1 | -1) {
    setView("chat");
    setTabWorkspace((workspace) => {
      if (workspace.tabs.length === 0) return workspace;
      const currentIndex = workspace.activeKey
        ? workspace.tabs.findIndex((tab) => tab.key === workspace.activeKey)
        : -1;
      const nextIndex = currentIndex < 0
        ? direction > 0 ? 0 : workspace.tabs.length - 1
        : (currentIndex + direction + workspace.tabs.length) % workspace.tabs.length;
      return { ...workspace, activeKey: workspace.tabs[nextIndex].key };
    });
  }

  useEffect(() => {
    localStorage.setItem(TABS_STORAGE_KEY, persistedTabsState);
  }, [persistedTabsState]);
  useEffect(() => {
    localStorage.setItem("sbW", String(sidebarWidth));
  }, [sidebarWidth]);
  useEffect(() => {
    localStorage.setItem("sbVaultSidebarOpen", String(vaultSidebarOpen));
  }, [vaultSidebarOpen]);
  useEffect(() => {
    localStorage.setItem("sbVaultSidebarWidth", String(vaultSidebarWidth));
  }, [vaultSidebarWidth]);
  useEffect(() => {
    localStorage.setItem("sbLocale", locale);
    i18n.activate(locale);
  }, [locale]);
  useEffect(() => {
    localStorage.setItem(KEYBINDINGS_STORAGE_KEY, JSON.stringify(keybindings));
  }, [keybindings]);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch(`${API}/v1/desktop-sessions/current`, { method: "DELETE" });
    } catch {
      // Local sign-out must still succeed if the server is temporarily unavailable.
    } finally {
      await invoke("clear_access_token").catch(() => undefined);
      await invoke("pause_watcher", { clearSession: true }).catch(() => undefined);
      window.location.reload();
    }
  }
  useEffect(() => {
    if (settingsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = shortcutFromEvent(event);
      if (!shortcut) return;
      const action = KEYBINDING_ACTIONS.find((item) => keybindings[item.id] === shortcut)?.id;
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      if (action === "magicMenu") setMagicMenuOpen((open) => !open);
      else if (magicMenuOpen) return;
      else if (action === "newChat") newChat();
      else if (action === "nextTab") cycleTab(1);
      else if (action === "previousTab") cycleTab(-1);
      else if (action === "toggleLeftSidebar") setSidebarOpen((open) => !open);
      else if (action === "toggleRightSidebar") setVaultSidebarOpen((open) => !open);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings, magicMenuOpen, settingsOpen]);
  useEffect(() => {
    const unlisten = listen("open-settings", () => setSettingsOpen(true));
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);
  useEffect(() => {
    const unlisten = listen("export-companion-log", () => void exportCompanionLog());
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);
  useEffect(() => {
    let externalStatusActive = false;
    void invoke<string>("get_watcher_status").then(setWatcherStatus).catch(() => {
      setWatcherStatus("Companion unavailable");
    });
    const unlisten = listen<string>("watcher-status", (event) => setWatcherStatus(event.payload));
    const pollSharedStatus = async () => {
      try {
        const response = await fetch(`${API}/settings`);
        if (!response.ok) return;
        const settings = await response.json() as { syncStatus?: string; lastSyncCheckAt?: string | null };
        const status = settings.syncStatus || "";
        const age = settings.lastSyncCheckAt ? Date.now() - new Date(settings.lastSyncCheckAt).getTime() : Infinity;
        const sharedStatus = (
          status.startsWith("⟳ Reindexing")
          || status.startsWith("✓ Watching ·")
          || status.startsWith("⚠️ Reindex")
        ) && age <= 60_000;
        if (sharedStatus) {
          externalStatusActive = true;
          setWatcherStatus(status);
        } else if (externalStatusActive) {
          externalStatusActive = false;
          void invoke<string>("get_watcher_status").then(setWatcherStatus);
        }
      } catch {
        /* The native watcher event remains the fallback source. */
      }
    };
    void pollSharedStatus();
    const statusPoll = window.setInterval(() => void pollSharedStatus(), 1_000);
    return () => {
      window.clearInterval(statusPoll);
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  // Drag the right edge of the sidebar to resize it (clamped). clientX maps
  // straight to width since the sidebar's left edge is the window's left edge.
  function startResize(e: ReactMouseEvent) {
    e.preventDefault();
    const move = (ev: MouseEvent) => setSidebarWidth(Math.min(480, Math.max(200, ev.clientX)));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function startVaultResize(e: ReactMouseEvent) {
    e.preventDefault();
    const move = (ev: MouseEvent) => {
      const requestedWidth = window.innerWidth - ev.clientX;
      setVaultSidebarWidth(Math.min(420, Math.max(220, requestedWidth)));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  async function refreshConvos() {
    try {
      const items: ConvoSummary[] = await (await fetch(`${API}/conversations`)).json();
      setConvos(items);
      setTabWorkspace((workspace) => ({
        ...workspace,
        tabs: workspace.tabs.map((tab) => {
          const conversation = items.find((item) => item.id === tab.conversationId);
          return conversation ? { ...tab, title: conversation.title } : tab;
        }),
      }));
    } catch {
      /* api down */
    }
  }
  async function refreshFolders() {
    try {
      setFolders(await (await fetch(`${API}/folders`)).json());
    } catch {
      /* api down */
    }
  }
  async function refreshSettings() {
    try {
      const s = normalizeSettings(await (await fetch(`${API}/settings`)).json());
      if (s.locale) setLocale(s.locale);
      setVaultPath(s.vaultRootPath || s.vaultPath || "");
    } catch {
      /* api down */
    }
  }
  useEffect(() => {
    refreshConvos();
    refreshFolders();
    refreshSettings();
    tabWorkspace.tabs.forEach((tab) => {
      if (tab.conversationId) void loadConversationTab(tab.key, tab.conversationId);
    });
  }, []);

  useEffect(() => {
    if (!folderEdit) return;
    const next = folders.find((f) => f.id === folderEdit.id);
    if (!next) setFolderEdit(null);
  }, [folderEdit, folders]);

  function resetToNewChat(projectId: string | null, note: VaultNote | null = null) {
    setView("chat");
    setTabWorkspace((workspace) => ({
      ...workspace,
      activeKey: null,
      home: createConversationTab(projectId, {
        key: "home",
        title: note?.title || "New chat",
        draftNote: note,
        version: workspace.home.version + 1,
      }),
    }));
  }

  function newChat() {
    resetToNewChat(null);
  }

  function newChatInProject(projectId: string) {
    resetToNewChat(projectId);
  }

  function chatWithNote(note: VaultNote) {
    resetToNewChat(null, note);
  }

  async function loadConversationTab(key: string, id: string) {
    updateTab(key, (tab) => ({ ...tab, loading: true }));
    try {
      const data = await (await fetch(`${API}/conversations/${id}`)).json();
      updateTab(key, (tab) => ({
        ...tab,
        conversationId: id,
        title: data.title || tab.title,
        projectId: data.folderId ?? null,
        mode: data.mode === "curator" ? "curator" : "read",
        messages: data.messages.map((m: { id: string; role: "user" | "brain"; text: string; facts: Fact[] | null; sources?: KnowledgeSource[] | null; actions?: MessageAction[] | null; createdAt?: string; noteChanges?: NoteChange[]; vaultDrafts?: VaultDraft[] }) => ({
          id: m.id,
          role: m.role,
          text: m.text,
          facts: m.facts ?? undefined,
          sources: m.sources ?? undefined,
          actions: m.actions ?? undefined,
          createdAt: m.createdAt,
          noteChanges: m.noteChanges ?? [],
          vaultDrafts: m.vaultDrafts ?? [],
        })),
        loading: false,
      }));
    } catch {
      updateTab(key, (tab) => ({ ...tab, loading: false }));
    }
  }

  async function openConvo(id: string) {
    setView("chat");
    const existing = tabWorkspace.tabs.find((tab) => tab.conversationId === id);
    if (existing) {
      setTabWorkspace((workspace) => ({ ...workspace, activeKey: existing.key }));
      if (!existing.loading && existing.messages.length === 0) await loadConversationTab(existing.key, id);
      return;
    }
    const summary = convos.find((convo) => convo.id === id);
    const tab = createConversationTab(summary?.folderId ?? null, {
      conversationId: id,
      title: summary?.title || "Conversation",
      mode: summary?.mode === "curator" ? "curator" : "read",
      loading: true,
    });
    setTabWorkspace((workspace) => ({ ...workspace, tabs: [...workspace.tabs, tab], activeKey: tab.key }));
    await loadConversationTab(tab.key, id);
  }

  function closeTab(key: string) {
    setTabWorkspace((workspace) => {
      const index = workspace.tabs.findIndex((tab) => tab.key === key);
      if (index < 0) return workspace;
      const tabs = workspace.tabs.filter((tab) => tab.key !== key);
      const activeKey = workspace.activeKey === key
        ? tabs[Math.min(index, tabs.length - 1)]?.key ?? null
        : workspace.activeKey;
      return { ...workspace, tabs, activeKey };
    });
  }

  async function removeConvo(id: string) {
    await fetch(`${API}/conversations/${id}`, { method: "DELETE" });
    setConvos((cs) => cs.filter((c) => c.id !== id));
    const matching = tabWorkspace.tabs.filter((tab) => tab.conversationId === id);
    matching.forEach((tab) => closeTab(tab.key));
  }

  async function archiveConvo(id: string) {
    await fetch(`${API}/conversations/${id}/archive`, { method: "POST" });
    setConvos((cs) => cs.filter((c) => c.id !== id));
    const matching = tabWorkspace.tabs.filter((tab) => tab.conversationId === id);
    matching.forEach((tab) => closeTab(tab.key));
  }

  async function moveConvo(id: string, folderId: string | null) {
    setTabWorkspace((workspace) => ({
      ...workspace,
      tabs: workspace.tabs.map((tab) => tab.conversationId === id ? { ...tab, projectId: folderId } : tab),
    }));
    setConvos((cs) => cs.map((c) => (c.id === id ? { ...c, folderId } : c)));
    await fetch(`${API}/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId }),
    });
  }

  async function changeConversationMode(mode: ConversationMode) {
    const key = activeTab.key;
    const id = activeTab.conversationId;
    updateTab(key, (tab) => ({ ...tab, mode }));
    if (!id) return;
    setConvos((items) => items.map((item) => item.id === id ? { ...item, mode } : item));
    await fetch(`${API}/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
  }

  async function renameConvo(id: string, title: string) {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    const convo = await (
      await fetch(`${API}/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle }),
      })
    ).json();
    setConvos((cs) =>
      cs.map((c) =>
        c.id === id
          ? { ...c, title: convo.title ?? nextTitle, updatedAt: convo.updatedAt ?? c.updatedAt }
          : c,
      ),
    );
    setTabWorkspace((workspace) => ({
      ...workspace,
      tabs: workspace.tabs.map((tab) => tab.conversationId === id
        ? { ...tab, title: convo.title ?? nextTitle }
        : tab),
    }));
  }

  async function createFolder(name: string) {
    const f = await (
      await fetch(`${API}/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
    ).json();
    setFolders((fs) => [...fs, f].sort((a, b) => a.name.localeCompare(b.name)));
  }

  async function deleteFolder(id: string) {
    await fetch(`${API}/folders/${id}`, { method: "DELETE" });
    setFolders((fs) => fs.filter((f) => f.id !== id));
    setConvos((cs) => cs.map((c) => (c.folderId === id ? { ...c, folderId: null } : c)));
    setTabWorkspace((workspace) => ({
      ...workspace,
      home: workspace.home.projectId === id ? { ...workspace.home, projectId: null } : workspace.home,
      tabs: workspace.tabs.map((tab) => tab.projectId === id ? { ...tab, projectId: null } : tab),
    }));
  }

  async function updateFolder(id: string, patch: { name?: string; icon?: string }) {
    const folder = await (
      await fetch(`${API}/folders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
    ).json();
    setFolders((fs) => fs.map((f) => (f.id === id ? folder : f)).sort((a, b) => a.name.localeCompare(b.name)));
    setFolderEdit((cur) => (cur?.id === id ? null : cur));
  }

  async function send(
    question: string,
    mentions: string[],
    attachments: ChatAttachment[] = [],
    regenerateMessageId?: string,
    toolContinuation?: {
      token: string;
      cycle: number;
      userMessageId: string;
      assistantMessageId: string;
      results: Array<{ id: string; result: Record<string, unknown> }>;
    },
  ) {
    if (!question.trim() || (busy && !toolContinuation)) return;

    let tabKey = activeTab.key;
    const capture = regenerateMessageId ? null : parseCaptureCommand(question);
    let id = activeId;
    if (!id) {
      const title = question.length > 48 ? question.slice(0, 48) + "…" : question;
      const res = await fetch(`${API}/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, folderId: selectedProjectId, mode: conversationMode }),
      });
      id = (await res.json()).id as string;
      const conversationTab = createConversationTab(selectedProjectId, {
        conversationId: id,
        title,
        mode: conversationMode,
      });
      tabKey = conversationTab.key;
      setTabWorkspace((workspace) => ({
        ...workspace,
        tabs: [...workspace.tabs, conversationTab],
        activeKey: conversationTab.key,
        home: createConversationTab(null, { key: "home", version: workspace.home.version + 1 }),
      }));
    }

    const sentAt = new Date().toISOString();
    const loadingStartedAt = Date.now();
    const displayQuestion = attachments.length > 0
      ? `${question}\n\n📎 ${attachments.map((attachment) => attachment.name).join(", ")}`
      : question;
    const previousAssistant = regenerateMessageId
      ? activeTab.messages[activeTab.messages.length - 1]
      : undefined;
    if (!toolContinuation) {
      updateTab(tabKey, (tab) => ({
        ...tab,
        busy: true,
        draftNote: null,
        messages: regenerateMessageId
          ? tab.messages.map((message, index) => index === tab.messages.length - 1
              ? {
                  ...message,
                  text: "",
                  facts: undefined,
                  sources: undefined,
                  actions: undefined,
                  error: undefined,
                  pendingSince: sentAt,
                }
              : message)
          : [
              ...tab.messages,
              { role: "user", text: displayQuestion, createdAt: sentAt },
              { role: "brain", text: "", pendingSince: sentAt },
            ],
      }));
    }
    const patchLast = (fn: (m: Msg) => Msg) =>
      updateTab(tabKey, (tab) => ({
        ...tab,
        messages: tab.messages.map((message, index) => index === tab.messages.length - 1 ? fn(message) : message),
      }));
    const finishLast = async (fn: (m: Msg) => Msg) => {
      const remaining = MIN_AGENT_LOADING_MS - (Date.now() - loadingStartedAt);
      if (remaining > 0) await wait(remaining);
      patchLast((m) => ({ ...fn(m), pendingSince: undefined }));
    };
    try {
      if (capture) {
        const res = await fetch(`${API}/capture/url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: capture.url,
            instruction: capture.instruction,
            conversationId: id,
            message: question,
          }),
        });
        const data = await res.json().catch(() => ({}));
        await finishLast((m) => ({
          ...m,
          text: data.answer || data.error || "Capture failed.",
          facts: data.facts ?? undefined,
          sources: data.sources ?? undefined,
          createdAt: new Date().toISOString(),
        }));
      } else {
        const agentQuestion = expandToolSlashCommand(question);
        const res = await fetch(`${API}/conversations/${id}/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: agentQuestion,
            displayQuestion,
            mentions,
            attachments,
            regenerateMessageId,
            continuationToken: toolContinuation?.token,
            localToolResults: toolContinuation?.results,
            toolCycle: toolContinuation?.cycle,
            continuationUserMessageId: toolContinuation?.userMessageId,
            continuationAssistantMessageId: toolContinuation?.assistantMessageId,
          }),
        });
        if (!res.ok || !res.body) {
          const result = await res.json().catch(() => ({}));
          throw new Error(result.error || "The response could not be generated.");
        }
        const reader = res.body!.getReader();
        const dec = new TextDecoder();
        let buf = "";
        let streamError: ChatError | null = null;
        let streamMessageIds: { userMessageId: string; assistantMessageId: string } | null = null;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const blocks = buf.split("\n\n");
          buf = blocks.pop() ?? "";
          for (const block of blocks) {
            const ev = block.match(/^event: (.*)$/m)?.[1] ?? "message";
            const data = block.match(/^data: ([\s\S]*)$/m)?.[1] ?? "";
            if (ev === "message_ids") {
              const ids = JSON.parse(data) as { userMessageId: string; assistantMessageId: string };
              streamMessageIds = ids;
              updateTab(tabKey, (tab) => ({
                ...tab,
                messages: tab.messages.map((message, index) => {
                  if (index === tab.messages.length - 2) return { ...message, id: ids.userMessageId };
                  if (index === tab.messages.length - 1) return { ...message, id: ids.assistantMessageId };
                  return message;
                }),
              }));
            }
            else if (ev === "tool_request") {
              const payload = JSON.parse(data) as { requests?: Array<{ id: string; name: string; arguments?: Record<string, unknown>; continuationToken: string; cycle: number }>; actions?: MessageAction[] };
              const requests = payload.requests ?? [];
              if (!streamMessageIds || requests.length === 0) throw new Error("The web tool request was incomplete.");
              const first = requests[0];
              patchLast((m) => ({
                ...m,
                actions: [
                  ...(m.actions ?? []),
                  ...(payload.actions ?? []),
                  ...requests.map((request) => ({
                    type: "tool_call" as const,
                    name: request.name,
                    label: request.name === "web_fetch" ? "Lecture des pages" : "Recherche web",
                    status: "pending" as const,
                    input: request.arguments ?? {},
                    summary: "En cours…",
                  })),
                ],
              }));
              const results = await Promise.all(requests.map(async (request) => {
                if (request.name !== "web_fetch") throw new Error(`Unsupported local tool: ${request.name}`);
                const response = await fetch(`${LOCAL_WEB_API}/fetch`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ urls: request.arguments?.urls ?? [] }),
                });
                const result = await response.json().catch(() => ({})) as Record<string, unknown>;
                if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : "The local web page fetch failed.");
                return { id: request.id, result };
              }));
              try { await reader.cancel(); } catch { /* stream already closed */ }
              await send(question, mentions, attachments, regenerateMessageId, {
                token: first.continuationToken,
                cycle: first.cycle,
                userMessageId: streamMessageIds.userMessageId,
                assistantMessageId: streamMessageIds.assistantMessageId,
                results,
              });
              return;
            }
            else if (ev === "facts") patchLast((m) => ({ ...m, facts: JSON.parse(data) }));
            else if (ev === "sources") patchLast((m) => ({ ...m, sources: JSON.parse(data) }));
            else if (ev === "actions") patchLast((m) => {
              const nextActions = JSON.parse(data) as MessageAction[];
              const existing = [...(m.actions ?? [])];
              for (const action of nextActions) {
                if (action.type !== "tool_call") {
                  existing.push(action);
                  continue;
                }
                const key = `${action.name}:${JSON.stringify(action.input ?? {})}`;
                const index = existing.findIndex((item) => item.type === "tool_call" && `${item.name}:${JSON.stringify(item.input ?? {})}` === key);
                if (index >= 0) existing[index] = action;
                else existing.push(action);
              }
              return { ...m, actions: existing };
            });
            else if (ev === "changes") patchLast((m) => ({ ...m, noteChanges: JSON.parse(data) }));
            else if (ev === "vault_draft") {
              const draft = JSON.parse(data) as VaultDraft & { sourceMessageId?: string };
              updateTab(tabKey, (tab) => ({
                ...tab,
                messages: tab.messages.map((message) => message.id === draft.sourceMessageId
                  ? { ...message, vaultDrafts: [draft] }
                  : message),
              }));
            }
            else if (ev === "token") {
              patchLast((m) => ({
                ...m,
                text: m.text + JSON.parse(data),
                pendingSince: undefined,
              }));
            }
            else if (ev === "error") {
              streamError = JSON.parse(data);
              patchLast((m) => ({
                ...m,
                error: streamError ?? undefined,
                text:
                  streamError?.message ||
                  "The AI provider rejected the request. Check your provider account and retry.",
              }));
            }
          }
          if (streamError) {
            try {
              await reader.cancel();
            } catch {
              /* stream may already be closed */
            }
            break;
          }
        }
        await finishLast((m) => ({
          ...m,
          createdAt: new Date().toISOString(),
          sources: m.sources?.some((source) => source.origin === "assistant_synthesis")
            ? m.sources
            : [
                ...(m.sources ?? []),
                {
                  origin: "assistant_synthesis",
                  authority: "low",
                  conversationId: id,
                  messageId: m.id,
                  title: "AI synthesis",
                },
              ],
        }));
      }
    } catch (e) {
      await finishLast((m) => ({
        ...(previousAssistant ?? m),
        error: {
          title: regenerateMessageId ? "Could not regenerate the response" : "Could not generate the response",
          message: e instanceof Error ? e.message : String(e),
          retryable: true,
        },
        createdAt: new Date().toISOString(),
      }));
    } finally {
      updateTab(tabKey, (tab) => ({ ...tab, busy: false }));
      refreshConvos();
    }
  }

  return (
    <MotionConfig reducedMotion="user">
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <AppHeader
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
        vaultSidebarOpen={vaultSidebarOpen}
        onToggleVaultSidebar={() => setVaultSidebarOpen((open) => !open)}
      />
      <div className="flex min-h-0 flex-1">
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.div
              key="sidebar"
              initial={{ width: 0 }}
              animate={{ width: sidebarWidth }}
              exit={{ width: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="relative shrink-0 overflow-hidden"
            >
              <div className="relative h-full" style={{ width: sidebarWidth }}>
                <Sidebar
                  folders={folders}
                  convos={convos}
                  activeId={activeId}
                  view={view}
                  watcherStatus={watcherStatus}
                  accessToken={accessToken}
                  profile={profile}
                  signingOut={signingOut}
                  onNew={newChat}
                  onNewInFolder={newChatInProject}
                  onSelect={openConvo}
                  onReview={() => setView("review")}
                  onArchive={() => setView("archive")}
                  onDelete={removeConvo}
                  onArchiveConvo={archiveConvo}
                  onMove={moveConvo}
                  onRename={renameConvo}
                  onNewFolder={createFolder}
                  onUpdateFolder={updateFolder}
                  onDeleteFolder={deleteFolder}
                  folderEdit={folderEdit}
                  onEditFolder={(next) => setFolderEdit(next)}
                  onSearchChats={() => setChatSearchOpen(true)}
                  onOpenSettings={() => { setSettingsSection("general"); setSettingsOpen(true); }}
                  onOpenAccount={() => { setSettingsSection("account"); setSettingsOpen(true); }}
                  onSignOut={() => void signOut()}
                  updateBadge={updateBadge}
                  onOpenUpdate={() => window.dispatchEvent(new Event(REOPEN_UPDATE_TOAST_EVENT))}
                />
                <div
                  onMouseDown={startResize}
                  className="absolute right-0 top-0 z-20 h-full w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-primary/40"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {view === "chat" && (
            <ConversationTabs
              tabs={tabWorkspace.tabs}
              activeKey={tabWorkspace.activeKey}
              onSelect={(key) => {
                setView("chat");
                setTabWorkspace((workspace) => ({ ...workspace, activeKey: key }));
              }}
              onClose={closeTab}
              onNew={newChat}
            />
          )}
          {view === "review" ? (
            <Review />
          ) : view === "archive" ? (
            <Archive onRestore={refreshConvos} onOpen={openConvo} />
          ) : activeTab.loading ? (
            <div className="flex min-h-0 flex-1 items-center justify-center text-[13px] text-muted-foreground">
              Loading conversation...
            </div>
          ) : activeId ? (
            <Thread
              key={activeTab.key}
              conversationId={activeId}
              messages={messages}
              busy={busy}
              onSend={send}
              onRegenerate={(question, messageId) => void send(question, [], [], messageId)}
              onOpenNote={setCitationPreviewNote}
              onPreviewConversation={setCitationPreviewConversationId}
              onOpenConversation={openConvo}
              onHome={newChat}
              folders={folders}
              projectId={selectedProjectId}
              onProjectChange={(folderId) => void moveConvo(activeId, folderId)}
              mode={conversationMode}
              onModeChange={(mode) => void changeConversationMode(mode)}
              vaultPath={vaultPath}
              composerDraft={activeTab.composerDraft}
              onComposerDraftChange={(composerDraft) => updateTab(activeTab.key, (tab) => ({ ...tab, composerDraft }))}
            />
          ) : (
            <Empty
              key={activeTab.key}
              busy={busy}
              onSend={send}
              onOpenIngest={() => setIngestOpen(true)}
              resetVersion={newChatVersion}
              folders={folders}
              projectId={selectedProjectId}
              onProjectChange={setSelectedProjectId}
              mode={conversationMode}
              onModeChange={setConversationMode}
              vaultPath={vaultPath}
              initialNote={draftNote}
              composerDraft={activeTab.composerDraft}
              onComposerDraftChange={(composerDraft) => updateTab(activeTab.key, (tab) => ({ ...tab, composerDraft }))}
            />
          )}
        </main>
        <AnimatePresence initial={false}>
          {vaultSidebarOpen && (
            <motion.div
              key="vault-sidebar"
              initial={{ width: 0 }}
              animate={{ width: vaultSidebarWidth }}
              exit={{ width: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="relative shrink-0 overflow-hidden"
            >
              <div className="relative h-full" style={{ width: vaultSidebarWidth }}>
                <div
                  onMouseDown={startVaultResize}
                  className="absolute left-0 top-0 z-20 h-full w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-primary/40"
                />
                <VaultSidebar
                  vaultPath={vaultPath}
                  onOpenNote={setCitationPreviewNote}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {magicMenuOpen && (
          <MagicMenu
            key="magic-menu"
            open
            currentNote={citationPreviewNote}
            onClose={() => setMagicMenuOpen(false)}
            onCreated={(run) => {
              setMagicMenuOpen(false);
              setCitationPreviewNote(null);
              setVaultActionRun(run);
            }}
          />
        )}
        {vaultActionRun && (
          <ConsolidationReviewModal
            key={`vault-action-${vaultActionRun.id}`}
            run={vaultActionRun}
            apiPath={`/vault/action-runs/${vaultActionRun.id}`}
            title={t`Review magic menu changes`}
            onClose={() => setVaultActionRun(null)}
            onOpenNote={setCitationPreviewNote}
          />
        )}
        {citationPreviewConversationId && (
          <ConversationPreviewModal
            key="citation-conversation"
            conversationId={citationPreviewConversationId}
            onClose={() => setCitationPreviewConversationId(null)}
            onOpen={(id) => {
              setCitationPreviewConversationId(null);
              void openConvo(id);
            }}
          />
        )}
        {citationPreviewNote && (
          <NotePreviewModal
            key="citation-note"
            vaultPath={vaultPath}
            note={citationPreviewNote}
            onClose={() => setCitationPreviewNote(null)}
            onChat={(note) => {
              setCitationPreviewNote(null);
              chatWithNote(note);
            }}
            onOpenObsidian={(note) => {
              const href = obsidianUrl(vaultPath, note.path, note.title);
              if (href) openObsidianLink(href);
            }}
          />
        )}
        {BETA.captureContent && ingestOpen && (
          <IngestModal key="ingest" vaultPath={vaultPath} onClose={() => setIngestOpen(false)} />
        )}
        {chatSearchOpen && (
          <ChatSearchModal
            key="chat-search"
            onClose={() => setChatSearchOpen(false)}
            onOpen={(id) => {
              setChatSearchOpen(false);
              void openConvo(id);
            }}
          />
        )}
        {settingsOpen && (
          <SettingsModal
            key="settings"
            onClose={() => setSettingsOpen(false)}
            initialSection={settingsSection}
            profile={profile}
            onLocaleChange={setLocale}
            onSettingsChange={(s) => setVaultPath(s.vaultRootPath || s.vaultPath || "")}
            accessToken={accessToken}
            keybindings={keybindings}
            onKeybindingsChange={setKeybindings}
          />
        )}
      </AnimatePresence>
    </div>
    </MotionConfig>
  );
}

function ConversationTabs(props: {
  tabs: ConversationTab[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onNew: () => void;
}) {
  return (
    <nav
      aria-label="Open conversations"
      className="flex h-9 shrink-0 items-end border-b border-border bg-background/75 px-2 backdrop-blur"
    >
      <div className="scrollbar-none flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto">
        <AnimatePresence initial={false}>
          {props.tabs.map((tab) => {
            const active = tab.key === props.activeKey;
            return (
              <motion.div
                layout
                key={tab.key}
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                role="tab"
                aria-selected={active}
                className={cn(
                  "group/tab relative flex h-8 max-w-[210px] shrink-0 items-center overflow-hidden rounded-t-lg border border-b-0 transition-colors",
                  active
                    ? "border-border bg-card text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                <button
                  type="button"
                  onClick={() => props.onSelect(tab.key)}
                  onAuxClick={(event) => event.button === 1 && props.onClose(tab.key)}
                  className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2.5 pr-1 text-left"
                >
                  {tab.busy ? (
                    <span className="relative flex size-2 shrink-0">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/50" />
                      <span className="relative inline-flex size-2 rounded-full bg-primary" />
                    </span>
                  ) : (
                    <MessageCircle className="size-3.5 shrink-0 opacity-70" />
                  )}
                  <span className="truncate text-[12px] font-medium">{tab.title}</span>
                </button>
                <button
                  type="button"
                  onClick={() => props.onClose(tab.key)}
                  title="Close tab"
                  aria-label={`Close ${tab.title}`}
                  className={cn(
                    "mr-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-all hover:bg-accent hover:text-foreground",
                    active ? "opacity-70" : "opacity-0 group-hover/tab:opacity-70",
                  )}
                >
                  <X className="size-3" />
                </button>
                {active && <motion.span layoutId="active-conversation-tab" className="absolute inset-x-1 bottom-0 h-px bg-primary/70" />}
              </motion.div>
            );
          })}
        </AnimatePresence>
        <button
          type="button"
          onClick={props.onNew}
          title="New chat"
          aria-label="New chat"
          className="mb-1 ml-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
    </nav>
  );
}

/** Custom macOS title bar: a draggable strip across the top. With
 * `titleBarStyle: Overlay`, the native traffic lights overlay the top-left, so
 * we pad it clear. Window-level controls belong here, not in the sidebar. */
function AppHeader(props: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  vaultSidebarOpen: boolean;
  onToggleVaultSidebar: () => void;
}) {
  
  return (
    <header
      data-tauri-drag-region
      className="flex h-[var(--app-titlebar-height)] shrink-0 select-none items-center gap-2 border-b border-sidebar-border bg-sidebar pl-20 pr-3"
    >
      <button
        onClick={props.onToggleSidebar}
        title={props.sidebarOpen ? t`Hide sidebar` : t`Show sidebar`}
        className="flex size-7 select-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
      >
        <Icon name="chevron-left" />
      </button>
      <div data-tauri-drag-region className="min-w-0 flex-1" />
      <button
        onClick={props.onToggleVaultSidebar}
        title={props.vaultSidebarOpen ? t`Hide vault sidebar` : t`Show vault sidebar`}
        aria-label={props.vaultSidebarOpen ? t`Hide vault sidebar` : t`Show vault sidebar`}
        className="flex size-7 select-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
      >
        <PanelRight className="size-4" />
      </button>
    </header>
  );
}

const NO_PROJECT_VALUE = "__no_project__";

export function ProjectSelector(props: {
  folders: Folder[];
  projectId: string | null;
  disabled?: boolean;
  onChange: (folderId: string | null) => void;
}) {
  return (
    <Select
      value={props.projectId ?? NO_PROJECT_VALUE}
      disabled={props.disabled}
      onValueChange={(value) => props.onChange(value === NO_PROJECT_VALUE ? null : value)}
    >
      <SelectTrigger
        size="sm"
        aria-label={t`Project`}
        className="h-7 w-auto max-w-48 gap-1.5 border-0 bg-transparent px-2 text-[12px] text-muted-foreground shadow-none hover:bg-secondary hover:text-foreground focus-visible:ring-1"
      >
        <Icon name="folder-1" className="text-[13px]" />
        <SelectValue placeholder={t`No project`} />
      </SelectTrigger>
      <SelectContent align="start" className="min-w-44">
        <SelectItem value={NO_PROJECT_VALUE}>{t`No project`}</SelectItem>
        {props.folders.map((folder) => (
          <SelectItem key={folder.id} value={folder.id}>
            {folder.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ModeSelector(props: {
  mode: ConversationMode;
  disabled?: boolean;
  onChange: (mode: ConversationMode) => void;
}) {
  return (
    <Select
      value={props.mode}
      disabled={props.disabled}
      onValueChange={(value) => props.onChange(value === "curator" ? "curator" : "read")}
    >
      <SelectTrigger
        size="sm"
        aria-label={t`Permission mode`}
        className={cn(
          "h-7 w-auto gap-1.5 border-0 bg-transparent px-2 text-[12px] shadow-none hover:bg-secondary focus-visible:ring-1",
          props.mode === "curator" ? "text-primary" : "text-muted-foreground",
        )}
      >
        {props.mode === "curator" ? <Sparkles className="size-3.5" /> : <BookOpen className="size-3.5" />}
        <span className="font-medium">{props.mode === "curator" ? t`Curator` : t`Read`}</span>
      </SelectTrigger>
      <SelectContent align="start" className="min-w-60">
        <SelectItem value="read">
          <span className="font-medium">{t`Read`}</span>
          <span className="ml-2 text-[11px] text-muted-foreground">{t`No note changes`}</span>
        </SelectItem>
        <SelectItem value="curator">
          <span className="font-medium">{t`Curator`}</span>
          <span className="ml-2 text-[11px] text-muted-foreground">{t`Can edit your vault`}</span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

export function ConversationModelSelector(props: { disabled: boolean }) {
  const [modelId, setModelId] = useState("");
  const [models, setModels] = useState<ConversationModelOption[]>([]);
  const [provider, setProvider] = useState<Settings["ingestionProvider"]>("openrouter");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("all");
  const [favorites, setFavorites] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("sillage:conversation-model-favorites") || "[]") as string[]; }
    catch { return []; }
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const settingsResponse = await fetch(`${API}/settings`);
        if (!settingsResponse.ok) return;
        const settings = normalizeSettings(await settingsResponse.json());
        if (cancelled) return;
        setProvider(settings.ingestionProvider);
        if (settings.ingestionProvider === "claude-code") {
          setModelId(settings.claudeModel);
          setModels(CLAUDE_CONVERSATION_MODELS);
          return;
        }
        setModelId(settings.defaultModel);
        if (!settings.hasOpenRouterApiKey) return;
        const catalogResponse = await fetch(`${API}/v1/openrouter/catalog`);
        if (!catalogResponse.ok) return;
        const catalog = await catalogResponse.json() as { models?: ConversationModelOption[] };
        if (!cancelled) setModels(catalog.models ?? []);
      } catch {
        /* Keep chat usable when the catalog is temporarily unavailable. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const updateModel = (event: Event) => {
      const detail = (event as CustomEvent<{ provider: Settings["ingestionProvider"]; model: string }>).detail;
      if (!detail?.model) return;
      setProvider(detail.provider);
      setModelId(detail.model);
      if (detail.provider === "claude-code") setModels(CLAUDE_CONVERSATION_MODELS);
    };
    window.addEventListener("sillage:conversation-model-change", updateModel);
    return () => window.removeEventListener("sillage:conversation-model-change", updateModel);
  }, []);

  const current = models.find((model) => model.id === modelId);
  const label = current?.name || modelId.split("/").at(-1) || "Conversation model";

  async function selectModel(nextModelId: string, nextProvider: Settings["ingestionProvider"] = provider) {
    if (!nextModelId || nextModelId === modelId) return;
    const previousModelId = modelId;
    const previousProvider = provider;
    setModelId(nextModelId);
    setProvider(nextProvider);
    setSaving(true);
    try {
      const response = await fetch(`${API}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextProvider === "claude-code"
          ? { ingestionProvider: nextProvider, claudeModel: nextModelId }
          : { ingestionProvider: nextProvider, defaultModel: nextModelId }),
      });
      if (!response.ok) {
        setModelId(previousModelId);
        setProvider(previousProvider);
      } else {
        window.dispatchEvent(new CustomEvent("sillage:conversation-model-change", { detail: { provider, model: nextModelId } }));
      }
    } catch {
      setModelId(previousModelId);
    } finally {
      setSaving(false);
    }
  }

  const options = modelId && !models.some((model) => model.id === modelId)
    ? [{ id: modelId, name: modelId }, ...models]
    : models;

  function toggleFavorite(id: string) {
    setFavorites((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      localStorage.setItem("sillage:conversation-model-favorites", JSON.stringify(next));
      return next;
    });
  }

  const companyKey = (id: string) => {
    const key = id.split("/")[0].toLowerCase();
    const aliases: Record<string, string> = {
      "meta-llama": "meta",
      "moonshotai": "moonshot",
      "xiaomimimo": "xiaomi",
      "x-ai": "grok",
      xai: "grok",
      "z-ai": "zai",
      mistralai: "mistral",
    };
    return aliases[key] ?? key;
  };
  const knownCompanies = [
    "anthropic",
    "deepseek",
    "google",
    "grok",
    "meta",
    "minimax",
    "mistral",
    "moonshot",
    "nousresearch",
    "openai",
    "perplexity",
    "qwen",
    "xiaomi",
    "zai",
  ];
  const allowedCompanies = new Set(knownCompanies);
  const availableOptions = options.filter((model) => allowedCompanies.has(companyKey(model.id)));
  const companies = Array.from(new Set(availableOptions.map((model) => companyKey(model.id))));
  const companyNames: Record<string, string> = {
    anthropic: "Anthropic",
    deepseek: "DeepSeek",
    google: "Google",
    grok: "Grok",
    meta: "Meta",
    minimax: "MiniMax",
    mistral: "Mistral",
    moonshot: "Moonshot",
    nousresearch: "NousResearch",
    openai: "OpenAI",
    perplexity: "Perplexity",
    qwen: "Qwen",
    xiaomi: "Xiaomi MiMo",
    zai: "Z.ai",
  };
  const companyLogos: Record<string, string> = {
    anthropic: "/images/providers/anthropic.svg",
    deepseek: "/images/providers/deepseek.svg",
    google: "/images/providers/google.svg",
    grok: "/images/providers/grok.svg",
    meta: "/images/providers/meta-color.svg",
    minimax: "/images/providers/minimax-color.svg",
    mistral: "/images/providers/mistral-color.svg",
    moonshot: "/images/providers/moonshot.svg",
    nousresearch: "/images/providers/nousresearch.svg",
    openai: "/images/providers/openai.svg",
    perplexity: "/images/providers/perplexity-color.svg",
    qwen: "/images/providers/qwen.svg",
    xiaomi: "/images/providers/xiaomimimo.svg",
    zai: "/images/providers/zai.svg",
  };
  const visibleModels = (provider === "claude-code" ? CLAUDE_CONVERSATION_MODELS : options)
    .filter((model) => provider === "claude-code" || allowedCompanies.has(companyKey(model.id)))
    .filter((model) => section !== "favorites" || favorites.includes(model.id))
    .filter((model) => provider === "claude-code" || section === "all" || section === "favorites" || companyKey(model.id) === section)
    .filter((model) => {
      const needle = query.trim().toLowerCase();
      return !needle || model.name.toLowerCase().includes(needle) || model.id.toLowerCase().includes(needle);
    });

  return (
    <div className="relative hidden sm:block">
      <button
        type="button"
        disabled={props.disabled || saving || options.length === 0}
        onClick={() => { setOpen((current) => !current); setQuery(""); }}
        className="inline-flex h-7 max-w-56 items-center gap-1.5 rounded-md border-0 bg-transparent px-2 text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
        aria-label="Conversation model"
        aria-expanded={open}
      >
        <Zap className="size-3.5 shrink-0" />
        <span className="truncate">{saving ? "Saving…" : label}</span>
        <ChevronDown className={cn("size-3", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-2 flex h-[min(520px,70vh)] w-[min(720px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl ring-1 ring-black/10">
          {provider === "openrouter" && <aside className="min-h-0 w-[25%] min-w-[155px] shrink-0 overflow-y-auto border-r border-border bg-muted/25 p-2.5">
            <div className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Fournisseurs</div>
            <div className="space-y-1">
              <button type="button" onClick={() => setSection("all")} className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] transition-colors", section === "all" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/60 hover:text-foreground")}><ChevronsUpDown className="size-3.5 shrink-0" /><span className="truncate">Tous</span></button>
              <button type="button" onClick={() => setSection("favorites")} className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] transition-colors", section === "favorites" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/60 hover:text-foreground")}><Star className="size-3.5 shrink-0" /><span className="truncate">Favoris</span></button>
              <div className="my-2 border-t border-border/70" />
              {companies.map((company) => <button key={company} type="button" onClick={() => setSection(company)} className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] transition-colors", section === company ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/60 hover:text-foreground")}>
                {companyLogos[company] ? <span aria-hidden className="size-4 shrink-0 bg-primary dark:bg-white" style={{ WebkitMaskImage: `url(${companyLogos[company]})`, maskImage: `url(${companyLogos[company]})`, WebkitMaskPosition: "center", maskPosition: "center", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", WebkitMaskSize: "contain", maskSize: "contain" }} /> : <span className="flex size-4 items-center justify-center rounded bg-primary/15 text-[9px] font-semibold uppercase text-primary dark:bg-white/15 dark:text-white">{company.slice(0, 1)}</span>}
                <span className="truncate">{companyNames[company] || company}</span>
              </button>)}
            </div>
          </aside>}
          <section className={cn("flex min-w-0 flex-1 flex-col", provider === "claude-code" && "w-full")}>
            <div className="border-b border-border p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un modèle…" className="h-10 w-full rounded-xl border border-border bg-background px-9 text-[13px] outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60 focus:ring-2 focus:ring-primary/15" />
              </div>
              <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-muted-foreground"><span>{provider === "claude-code" ? "Modèles Claude Code" : section === "favorites" ? "Vos favoris" : section === "all" ? "Tous les modèles" : companyNames[section] || section}</span><span>{visibleModels.length} modèle{visibleModels.length === 1 ? "" : "s"}</span></div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {visibleModels.length === 0 ? <div className="flex h-full items-center justify-center px-8 text-center text-[12px] text-muted-foreground">Aucun modèle ne correspond à cette recherche.</div> : visibleModels.map((model) => {
                const selected = model.id === modelId;
                const favorite = favorites.includes(model.id);
                return <div key={model.id} className={cn("group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-accent/70", selected && "bg-accent")}>
                  <button type="button" onClick={() => { void selectModel(model.id, provider); setOpen(false); }} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[13px] font-medium text-foreground">{model.name}</span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground" title={model.id}>{model.id}</span>
                  </button>
                  {selected && <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">Actif</span>}
                  {provider === "openrouter" && <button type="button" onClick={() => toggleFavorite(model.id)} className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-background hover:text-amber-400" aria-label={favorite ? "Retirer des favoris" : "Ajouter aux favoris"}>{favorite ? <Star className="size-4 fill-amber-400 text-amber-400" /> : <Star className="size-4" />}</button>}
                </div>;
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export function syncModelSignature(settings: Pick<Settings, "ingestionModel" | "embeddingModel" | "ingestionProvider" | "claudeIngestionModel" | "claudeEmbeddingModel">) {
  return `${settings.ingestionProvider}\n${settings.ingestionModel}\n${settings.embeddingModel}\n${settings.claudeIngestionModel}\n${settings.claudeEmbeddingModel}`;
}

export type ClaudeAuthStatus = {
  installed: boolean;
  authenticated: boolean;
  authMethod?: string | null;
  apiProvider?: string | null;
  subscriptionType?: string | null;
  version?: string | null;
  error?: string | null;
};

function ClaudeLocalBridgeSettings(props: { onStatusChange: (status: ClaudeAuthStatus | null) => void }) {
  const [status, setStatus] = useState<ClaudeAuthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const nextStatus = await invoke<ClaudeAuthStatus>("get_claude_auth_status");
      setStatus(nextStatus);
      props.onStatusChange(nextStatus);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const nextStatus = await invoke<ClaudeAuthStatus>("connect_claude");
      setStatus(nextStatus);
      props.onStatusChange(nextStatus);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const connected = Boolean(status?.installed && status.authenticated);
  const statusLabel = !status
    ? "Checking Claude Code…"
    : !status.installed
      ? "Claude Code is not installed"
      : connected
        ? `Connected${status.subscriptionType ? ` · ${status.subscriptionType}` : ""}`
        : "Claude subscription is not connected";

  return (
    <section>
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-medium">Claude local bridge</h2>
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-amber-600 dark:text-amber-400">Experimental</span>
        </div>
        <p className="mt-1 text-[12px] text-muted-foreground">Uses Claude Code's official local login. Sillage never reads or stores the OAuth credential.</p>
      </div>
      <div className="rounded-xl border border-border bg-card px-4">
        <div className="flex min-h-20 items-center justify-between gap-6 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", connected ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-secondary text-muted-foreground")}>
              {connected ? <Check className="size-4" /> : <Bot className="size-4" />}
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-medium">{statusLabel}</div>
              <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                {status?.error || status?.version || "Local extraction bridge"}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={busy}>Refresh</Button>
            {status?.installed && !connected && (
              <Button size="sm" onClick={() => void connect()} disabled={busy}>
                {busy ? "Waiting for Claude…" : "Connect Claude"}
              </Button>
            )}
          </div>
        </div>
      </div>
      {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}
      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">Claude reads your notes with your subscription. Your chosen search model connects related ideas privately on this computer.</p>
    </section>
  );
}

export function AiSyncSettingsPanel(props: {
  settings: Settings;
  models: ConversationModelOption[];
  embeddingModels: ConversationModelOption[];
  catalogError: string | null;
  onChange: (settings: Settings) => void;
  onClaudeStatusChange: (status: ClaudeAuthStatus | null) => void;
}) {
  const presets = useMemo(
    () => buildMemoryPresets(props.models, props.embeddingModels),
    [props.models, props.embeddingModels],
  );
  const fallbackLevel = closestMemoryPreset(
    presets,
    props.settings.ingestionModel,
    props.settings.embeddingModel,
  );
  const level = presets.length
    ? Math.max(0, Math.min(props.settings.memoryPresetLevel ?? fallbackLevel, presets.length - 1))
    : 0;
  const selectedPreset = presets[level];
  const selectedIngestionModel = props.models.find((model) => model.id === props.settings.ingestionModel)
    ?? selectedPreset?.ingestionModel;
  const selectedEmbeddingModel = props.embeddingModels.find((model) => model.id === props.settings.embeddingModel)
    ?? selectedPreset?.embeddingModel;
  const finestModels = FINEST_INGESTION_MODEL_IDS
    .map((id) => props.models.find((model) => model.id === id))
    .filter((model): model is ConversationModelOption => Boolean(model));
  const finest = presets.length > 0 && level === presets.length - 1;
  const claudeProfileIndex = findClaudeMemoryProfile(
    props.settings.claudeIngestionModel,
    props.settings.claudeEmbeddingModel,
  );
  const displayedClaudeProfileIndex = claudeProfileIndex >= 0 ? claudeProfileIndex : 1;
  const selectedClaudeProfile = claudeProfileIndex >= 0
    ? CLAUDE_MEMORY_PROFILES[claudeProfileIndex]
    : null;

  function chooseLevel(nextLevel: number) {
    if (props.settings.ingestionProvider === "claude-code") return;
    const preset = presets[nextLevel];
    if (!preset) return;
    props.onChange({
      ...props.settings,
      memoryPresetLevel: nextLevel,
      ingestionModel: preset.ingestionModel.id,
      embeddingModel: preset.embeddingModel.id,
    });
  }

  function chooseClaudeProfile(nextLevel: number) {
    const profile = CLAUDE_MEMORY_PROFILES[nextLevel];
    if (!profile) return;
    props.onChange({
      ...props.settings,
      claudeIngestionModel: profile.ingestionModel,
      claudeEmbeddingModel: profile.embeddingModel,
    });
  }

  return (
    <div className="mt-9 flex flex-col gap-8">
      <section>
        <div className="mb-2">
          <h2 className="text-[13px] font-medium">Ingestion engine</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">Choose where note extraction runs. Changing this rebuilds the vault index.</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-4">
          <div className="flex min-h-16 items-center justify-between gap-6 py-3">
            <div className="min-w-0">
              <div className="text-[13px] font-medium">Note extraction</div>
              <div className="mt-0.5 text-[12px] text-muted-foreground">
                {props.settings.ingestionProvider === "claude-code"
                  ? "Runs through your Claude Code subscription on this computer"
                  : "Runs in Sillage Cloud through OpenRouter"}
              </div>
            </div>
            <Select
              value={props.settings.ingestionProvider}
              onValueChange={(ingestionProvider) => props.onChange({
                ...props.settings,
                ingestionProvider: ingestionProvider as Settings["ingestionProvider"],
              })}
            >
              <SelectTrigger className="h-9 w-[260px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="openrouter">Sillage Cloud · OpenRouter</SelectItem>
                <SelectItem value="claude-code">Claude Code · local</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {props.settings.ingestionProvider === "claude-code" && (
            <div className="border-t border-border py-4">
              <div className="mb-3 flex items-center justify-between gap-4">
                <div>
                  <div className="text-[13px] font-medium">Your memory duo</div>
                  <div className="mt-0.5 text-[12px] text-muted-foreground">Claude reads each note. E5 reconnects the ideas later.</div>
                </div>
                <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-emerald-600 dark:text-emerald-400">Runs here</span>
              </div>
              <div className="rounded-xl border border-border/70 bg-secondary/45 p-4">
                <div className="flex items-baseline justify-between gap-4">
                  <div>
                    <p className="text-[15px] font-semibold">{selectedClaudeProfile?.label || "Choose your duo"}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{selectedClaudeProfile?.description || "Move the slider to select both models."}</p>
                  </div>
                  {claudeProfileIndex === 1 && <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-primary">Recommended</span>}
                </div>
                <div className="relative mt-6 h-6 rounded-full focus-within:ring-2 focus-within:ring-primary/40">
                  <input type="range" min={0} max={CLAUDE_MEMORY_PROFILES.length - 1} step={1} value={displayedClaudeProfileIndex} onChange={(event) => chooseClaudeProfile(Number(event.target.value))} aria-label="Claude memory duo" className="absolute inset-0 z-30 h-full w-full cursor-pointer opacity-0" />
                  <div className="pointer-events-none absolute inset-x-3 inset-y-0" aria-hidden="true">
                    <span className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[linear-gradient(90deg,color-mix(in_srgb,var(--muted-foreground)_25%,transparent),var(--primary))]" />
                    {CLAUDE_MEMORY_PROFILES.map((profile, index) => <span key={profile.label} className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-muted-foreground" style={{ left: `${index * 100 / (CLAUDE_MEMORY_PROFILES.length - 1)}%` }} />)}
                    <span className={cn("absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-background shadow-md transition-[left]", selectedClaudeProfile ? "bg-primary" : "bg-muted-foreground")} style={{ left: `${displayedClaudeProfileIndex * 100 / (CLAUDE_MEMORY_PROFILES.length - 1)}%` }} />
                  </div>
                </div>
                <div className="relative mx-3 mt-3 h-4">
                  {CLAUDE_MEMORY_PROFILES.map((profile, index) => <button key={profile.label} type="button" onClick={() => chooseClaudeProfile(index)} className={cn("absolute -translate-x-1/2 whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.08em]", index === claudeProfileIndex ? "text-primary" : "text-muted-foreground hover:text-foreground")} style={{ left: `${index * 100 / (CLAUDE_MEMORY_PROFILES.length - 1)}%` }}>{profile.label}</button>)}
                </div>
                {selectedClaudeProfile && <div className="mt-4 grid gap-2 border-t border-border/70 pt-4 sm:grid-cols-2">
                  <div className="rounded-lg bg-background/70 px-3 py-2.5"><div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"><Sparkles className="size-3 text-primary" /> Reads &amp; structures</div><p className="mt-1 text-[13px] font-medium">{selectedClaudeProfile.ingestionLabel}</p></div>
                  <div className="rounded-lg bg-background/70 px-3 py-2.5"><div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"><Search className="size-3 text-primary" /> Finds related ideas</div><p className="mt-1 text-[13px] font-medium">{selectedClaudeProfile.embeddingLabel}</p></div>
                </div>}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">The search model downloads once, then runs privately on CPU. Changing either model rebuilds the vault index.</p>
            </div>
          )}
        </div>
      </section>

      {props.settings.ingestionProvider === "claude-code" && <ClaudeLocalBridgeSettings onStatusChange={props.onClaudeStatusChange} />}

      <section>
        <div className="mb-2 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-[13px] font-medium">Conversation model</h2>
            <p className="mt-1 text-[12px] text-muted-foreground">{props.settings.ingestionProvider === "claude-code" ? "Runs locally through the connected Claude Code subscription." : "Used to answer your questions through OpenRouter. Changing it does not rebuild memory."}</p>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card px-4">
          <div className="flex min-h-16 items-center justify-between gap-6 py-3">
            <div className="min-w-0">
              <div className="text-[13px] font-medium">Default model</div>
              <div className="mt-0.5 truncate text-[12px] text-muted-foreground">{props.settings.ingestionProvider === "claude-code" ? `Claude Code · ${props.settings.claudeModel}` : props.settings.defaultModel}</div>
            </div>
            <Select
              value={props.settings.ingestionProvider === "claude-code" ? props.settings.claudeModel : props.settings.defaultModel}
              disabled={props.settings.ingestionProvider !== "claude-code" && !props.models.length}
              onValueChange={(model) => props.onChange(props.settings.ingestionProvider === "claude-code"
                ? { ...props.settings, claudeModel: model }
                : { ...props.settings, defaultModel: model })}
            >
              <SelectTrigger className="h-9 w-[300px] max-w-[48vw]"><SelectValue placeholder="Choose a model" /></SelectTrigger>
              <SelectContent className="max-h-80 max-w-[440px]">
                {(props.settings.ingestionProvider === "claude-code" ? CLAUDE_CONVERSATION_MODELS : props.models).map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    <span className="block max-w-[360px] truncate" title={model.id}>{model.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {props.settings.ingestionProvider !== "claude-code" && <section>
        <div className="mb-2">
          <h2 className="text-[13px] font-medium">Memory & semantic search</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">Controls how Sillage understands notes and finds related ideas.</p>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5">
          <div className="pointer-events-none absolute -right-20 -top-24 size-56 rounded-full bg-primary/8 blur-3xl" />
          {selectedPreset ? (
            <div className="relative">
              <div className="flex items-start gap-3.5">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><BrainCircuit className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-4">
                    <div>
                      <p className="text-lg font-semibold tracking-tight">{selectedPreset.label}</p>
                      <p className="mt-0.5 text-[12px] text-muted-foreground">{selectedPreset.description}</p>
                    </div>
                    {level === 2 && <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-primary">Recommended</span>}
                  </div>
                  <div className="relative mt-7 h-6 rounded-full focus-within:ring-2 focus-within:ring-primary/40">
                    <input
                      type="range"
                      min={0}
                      max={presets.length - 1}
                      step={1}
                      value={level}
                      onChange={(event) => chooseLevel(Number(event.target.value))}
                      aria-label="Memory extraction depth"
                      className="absolute inset-0 z-30 h-full w-full cursor-pointer opacity-0"
                    />
                    <div className="pointer-events-none absolute inset-x-3 inset-y-0" aria-hidden="true">
                      <span className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[linear-gradient(90deg,color-mix(in_srgb,var(--muted-foreground)_25%,transparent),var(--primary))]" />
                      {presets.map((preset, index) => (
                        <span key={preset.label} className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-muted-foreground" style={{ left: `${index * 100 / Math.max(1, presets.length - 1)}%` }} />
                      ))}
                      <span className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-background bg-primary shadow-md transition-[left]" style={{ left: `${level * 100 / Math.max(1, presets.length - 1)}%` }} />
                    </div>
                  </div>
                  <div className="relative mx-3 mt-3 h-4">
                    {presets.map((preset, index) => (
                      <button key={preset.label} type="button" onClick={() => chooseLevel(index)} className={cn("absolute -translate-x-1/2 whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.08em]", index === level ? "text-primary" : "text-muted-foreground hover:text-foreground")} style={{ left: `${index * 100 / Math.max(1, presets.length - 1)}%` }}>{preset.label}</button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-2 border-t border-border/70 pt-4 sm:grid-cols-2">
                <div className="rounded-xl bg-secondary/65 px-4 py-3">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Understands your notes</p>
                  {finest && finestModels.length ? (
                    <Select value={props.settings.ingestionModel} onValueChange={(ingestionModel) => props.onChange({ ...props.settings, ingestionModel })}>
                      <SelectTrigger className="mt-1 h-7 w-full border-0 bg-transparent px-0 text-[13px] shadow-none"><SelectValue /></SelectTrigger>
                      <SelectContent>{finestModels.map((model) => <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : <p className="mt-1 truncate text-[13px] font-medium">{selectedIngestionModel?.name}</p>}
                </div>
                <div className="rounded-xl bg-secondary/65 px-4 py-3">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Finds related ideas</p>
                  <p className="mt-1 truncate text-[13px] font-medium">{selectedEmbeddingModel?.name}</p>
                </div>
              </div>
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] leading-4 text-muted-foreground">
                <RotateCcw className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                <span>Changing this preset reindexes the complete vault with the new models. Existing notes remain available while the sync runs.</span>
              </div>
            </div>
          ) : (
            <div className="flex min-h-36 items-center justify-center text-center text-[12px] text-muted-foreground">
              {props.catalogError || "Loading OpenRouter models…"}
            </div>
          )}
        </div>
      </section>}
    </div>
  );
}
function Empty(props: {
  busy: boolean;
  onSend: (q: string, m: string[], attachments?: ChatAttachment[]) => void;
  onOpenIngest: () => void;
  resetVersion: number;
  folders: Folder[];
  projectId: string | null;
  onProjectChange: (folderId: string | null) => void;
  mode: ConversationMode;
  onModeChange: (mode: ConversationMode) => void;
  vaultPath: string;
  initialNote: VaultNote | null;
  composerDraft: ComposerDraftState;
  onComposerDraftChange: (draft: ComposerDraftState) => void;
}) {
  const [preset, setPreset] = useState<ComposerPreset>({ text: "", version: 0 });
  const actions = [
    {
      title: t`Explore my knowledge`,
      description: t`Search across notes and surface the most useful context`,
      icon: "search",
      prompt: t`Explore my notes and show me the most important themes.`,
    },
    {
      title: t`Connect ideas`,
      description: t`Find relationships and patterns across my second brain`,
      icon: "bulb-2",
      prompt: t`Find surprising connections between ideas in my notes.`,
    },
    {
      title: t`Summarize a topic`,
      description: t`Turn scattered knowledge into a concise overview`,
      icon: "article",
      prompt: t`Summarize what I know about `,
    },
    ...(BETA.captureContent
      ? [{
          title: t`Capture content`,
          description: t`Add a web page, video, or audio file to the vault`,
          icon: "link",
          onClick: props.onOpenIngest,
        }]
      : []),
  ];
  const seedComposer = (text: string) => setPreset({ text, version: Date.now() });

  useEffect(() => {
    if (props.resetVersion === 0) return;
    setPreset({ text: "", version: props.resetVersion });
  }, [props.resetVersion]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 items-center overflow-y-auto px-6 py-8">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto w-full max-w-5xl"
        >
          <div className="mb-10 text-center">
            <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground shadow-sm">
              <Icon name="bot" className="text-[23px]" />
            </div>
            <h1 className="text-balance text-[30px] font-medium tracking-[-0.025em]">
              {t`What should we explore in your second brain?`}
            </h1>
            <p className="mx-auto mt-2 max-w-xl text-[13px] leading-5 text-muted-foreground">
              {BETA.captureContent
                ? t`Ask across your notes, uncover connections, or capture something new.`
                : t`Ask across your notes and uncover connections.`}
            </p>
          </div>

          <div className={BETA.captureContent
            ? "grid grid-cols-2 gap-3 lg:grid-cols-4"
            : "mx-auto grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3"}>
            {actions.map((action, index) => (
              <motion.button
                key={action.title}
                type="button"
                disabled={props.busy}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 + index * 0.035, duration: 0.25 }}
                whileHover={{ y: -2 }}
                onClick={() => "onClick" in action && action.onClick
                  ? action.onClick()
                  : seedComposer("prompt" in action ? (action.prompt ?? "") : "")}
                className="group flex min-h-36 flex-col rounded-2xl border border-border bg-card/45 p-4 text-left transition-[border-color,background-color,box-shadow] hover:border-muted-foreground/45 hover:bg-card hover:shadow-lg hover:shadow-black/10 disabled:pointer-events-none disabled:opacity-50"
              >
                <span className="flex size-8 items-center justify-center rounded-lg border border-border bg-secondary/65 text-muted-foreground transition-[border-color,background-color,color] group-hover:border-primary/30 group-hover:bg-primary/10 group-hover:text-primary">
                  <Icon name={action.icon} className="text-[17px]" />
                </span>
                <span className="mt-auto block text-[15px] font-medium tracking-[-0.01em]">
                  {action.title}
                </span>
                <span className="mt-1 block text-[12px] leading-[1.45] text-muted-foreground">
                  {action.description}
                </span>
              </motion.button>
            ))}
          </div>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12, duration: 0.3 }}
        className="mx-auto w-full max-w-5xl px-6 pb-5"
      >
        <Composer
          busy={props.busy}
          onSend={props.onSend}
          centered
          landing
          preset={preset}
          folders={props.folders}
          projectId={props.projectId}
          onProjectChange={props.onProjectChange}
          mode={props.mode}
          onModeChange={props.onModeChange}
          vaultPath={props.vaultPath}
          initialNote={props.initialNote}
          draft={props.composerDraft}
          onDraftChange={props.onComposerDraftChange}
        />
      </motion.div>
    </div>
  );
}
