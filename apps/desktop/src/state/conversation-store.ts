import { createStore, useStore } from "@tanstack/react-store";
import type { ConversationTab, TabWorkspace } from "@/App";

export const TABS_STORAGE_KEY = "sbConversationTabs";

export function createConversationTab(
  projectId: string | null = null,
  options: Partial<ConversationTab> = {},
): ConversationTab {
  const key = options.key || `tab-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
  return {
    key,
    conversationId: null,
    title: "New chat",
    messages: [],
    busy: false,
    loading: false,
    projectId,
    mode: "read",
    draftNote: null,
    composerDraft: { text: "", mentions: [], attachments: [] },
    version: 0,
    ...options,
  };
}

function initialWorkspace(): TabWorkspace {
  const home = createConversationTab(null, { key: "home" });
  try {
    const saved = JSON.parse(localStorage.getItem(TABS_STORAGE_KEY) || "null") as {
      activeKey?: string | null;
      tabs?: Array<Pick<ConversationTab, "key" | "conversationId" | "title" | "projectId" | "mode">>;
    } | null;
    const tabs = (saved?.tabs || [])
      .filter((tab) => Boolean(tab.conversationId))
      .slice(0, 12)
      .map((tab) => createConversationTab(tab.projectId, {
        key: tab.key,
        conversationId: tab.conversationId,
        title: tab.title || "Conversation",
        mode: tab.mode === "curator" ? "curator" : "read",
        loading: true,
      }));
    return {
      tabs,
      activeKey: tabs.some((tab) => tab.key === saved?.activeKey) ? saved!.activeKey! : null,
      home,
    };
  } catch {
    return { tabs: [], activeKey: null, home };
  }
}

export const conversationStore = createStore<{ workspace: TabWorkspace }>({ workspace: initialWorkspace() });

export const conversationActions = {
  setWorkspace: (next: TabWorkspace | ((current: TabWorkspace) => TabWorkspace)) => conversationStore.setState((state) => ({
    workspace: typeof next === "function" ? next(state.workspace) : next,
  })),
};

export function useConversationStore<T>(selector: (state: { workspace: TabWorkspace }) => T): T {
  return useStore(conversationStore, selector);
}
