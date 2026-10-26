import { createStore, useStore } from "@tanstack/react-store";

export type DesktopView = "chat" | "review" | "archive";
export type SettingsSection = "account" | "general" | "ai-sync" | "keybindings";

type UiState = {
  view: DesktopView;
  sidebarOpen: boolean;
  vaultSidebarOpen: boolean;
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  ingestOpen: boolean;
  chatSearchOpen: boolean;
  magicMenuOpen: boolean;
};

export const uiStore = createStore<UiState>({
  view: "chat",
  sidebarOpen: true,
  vaultSidebarOpen: typeof localStorage === "undefined" || localStorage.getItem("sbVaultSidebarOpen") !== "false",
  settingsOpen: false,
  settingsSection: "general",
  ingestOpen: false,
  chatSearchOpen: false,
  magicMenuOpen: false,
});

export const uiActions = {
  setView: (view: DesktopView) => uiStore.setState((state) => ({ ...state, view })),
  setSidebarOpen: (sidebarOpen: boolean | ((current: boolean) => boolean)) => uiStore.setState((state) => ({
    ...state,
    sidebarOpen: typeof sidebarOpen === "function" ? sidebarOpen(state.sidebarOpen) : sidebarOpen,
  })),
  setVaultSidebarOpen: (vaultSidebarOpen: boolean | ((current: boolean) => boolean)) => uiStore.setState((state) => ({
    ...state,
    vaultSidebarOpen: typeof vaultSidebarOpen === "function" ? vaultSidebarOpen(state.vaultSidebarOpen) : vaultSidebarOpen,
  })),
  setSettingsOpen: (settingsOpen: boolean) => uiStore.setState((state) => ({ ...state, settingsOpen })),
  setSettingsSection: (settingsSection: SettingsSection) => uiStore.setState((state) => ({ ...state, settingsSection })),
  setIngestOpen: (ingestOpen: boolean) => uiStore.setState((state) => ({ ...state, ingestOpen })),
  setChatSearchOpen: (chatSearchOpen: boolean) => uiStore.setState((state) => ({ ...state, chatSearchOpen })),
  setMagicMenuOpen: (magicMenuOpen: boolean | ((current: boolean) => boolean)) => uiStore.setState((state) => ({
    ...state,
    magicMenuOpen: typeof magicMenuOpen === "function" ? magicMenuOpen(state.magicMenuOpen) : magicMenuOpen,
  })),
};

export function useUiStore<T>(selector: (state: UiState) => T): T {
  return useStore(uiStore, selector);
}
