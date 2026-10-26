import { useEffect, useState } from "react";
import { t } from "@lingui/core/macro";
import { BrainCircuit, ExternalLink, Keyboard as KeyboardIcon } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { motion } from "motion/react";
import { API_URL as API } from "@/lib/api";
import { listLocalVaultNotes } from "@/lib/local-vault";
import { cn } from "@/lib/utils";
import { hasSelectedClaudeMemoryProfile } from "@/lib/claude-memory-profiles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ClaudeAuthStatus, Keybindings, Settings, UserProfile, ConversationModelOption } from "@/App";
import { AiSyncSettingsPanel, Icon, isVaultSourceType, normalizeSettings, syncModelSignature, CLAUDE_CONVERSATION_MODELS, AVAILABLE_VAULT_SOURCES, VAULT_SOURCE_LABELS } from "@/App";
import { KeyboardShortcutsSettings } from "@/components/workspace-panes";

export function AccountSettingsPanel({ profile }: { profile: UserProfile | null }) {
  const billing = profile?.billing;
  const planName = billing?.plan ? billing.plan.charAt(0).toUpperCase() + billing.plan.slice(1) : "No active subscription";
  const usage = billing ? Math.min(100, Math.round((billing.indexedNotes / Math.max(1, billing.noteLimit)) * 100)) : 0;
  const siteUrl = (import.meta.env.VITE_SITE_URL?.trim() || API).replace(/\/+$/, "");

  return <div className="mt-9 max-w-[680px]">
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Subscription</p>
          <h2 className="mt-3 text-[28px] font-semibold tracking-tight">{planName}</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">{billing?.canceledAt ? "Cancellation scheduled" : billing?.active ? "Your subscription is active." : "No active subscription"}</p>
        </div>
        {billing?.active && <span className="rounded-full bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary">Active</span>}
      </div>
      <div className="mt-8">
        <div className="flex items-baseline justify-between gap-4 text-[13px]">
          <span><strong>{billing?.indexedNotes.toLocaleString() ?? "—"}</strong> of <strong>{billing?.noteLimit.toLocaleString() ?? "—"}</strong> notes indexed</span>
          <span className="text-muted-foreground">{billing ? `${usage}%` : ""}</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-primary/15" role="progressbar" aria-label="Indexed notes usage" aria-valuemin={0} aria-valuemax={billing?.noteLimit ?? 0} aria-valuenow={billing?.indexedNotes ?? 0}>
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${usage}%` }} />
        </div>
      </div>
      <button type="button" className="mt-8 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-[13px] font-medium transition-colors hover:bg-accent" onClick={() => void openUrl(`${siteUrl}/account?tab=subscription`)}>
        Manage subscription <ExternalLink className="size-3.5" />
      </button>
    </div>
  </div>;
}

export function SettingsModal(props: {
  onClose: () => void;
  initialSection: "account" | "general" | "ai-sync" | "keybindings";
  profile: UserProfile | null;
  onLocaleChange: (locale: string) => void;
  onSettingsChange: (settings: Settings) => void;
  accessToken: string;
  keybindings: Keybindings;
  onKeybindingsChange: (keybindings: Keybindings) => void;
}) {
  
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initialVaultKey, setInitialVaultKey] = useState<string>("");
  const [initialSyncSignature, setInitialSyncSignature] = useState("");
  const [section, setSection] = useState(props.initialSection);
  const [inboxFolders, setInboxFolders] = useState<string[]>([]);
  const [models, setModels] = useState<ConversationModelOption[]>([]);
  const [embeddingModels, setEmbeddingModels] = useState<ConversationModelOption[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [claudeStatus, setClaudeStatus] = useState<ClaudeAuthStatus | null>(null);

  async function loadSettings() {
    setLoadError(null);
    try {
      const response = await fetch(`${API}/settings`);
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      const settings = normalizeSettings(await response.json());
      setS(settings);
      setInitialVaultKey(`${settings.vaultSourceType}:${settings.vaultRootPath}`);
      setInitialSyncSignature(syncModelSignature(settings));
      if (settings.ingestionProvider === "claude-code") {
        setModels(CLAUDE_CONVERSATION_MODELS);
        setEmbeddingModels([]);
        setCatalogError(null);
      } else if (settings.hasOpenRouterApiKey) {
        const catalogResponse = await fetch(`${API}/v1/openrouter/catalog`);
        if (catalogResponse.ok) {
          const catalog = await catalogResponse.json() as {
            models?: ConversationModelOption[];
            embeddingModels?: ConversationModelOption[];
          };
          const conversationModels = catalog.models ?? [];
          setModels(conversationModels.some((model) => model.id === settings.defaultModel)
            ? conversationModels
            : [{ id: settings.defaultModel, name: settings.defaultModel }, ...conversationModels]);
          setEmbeddingModels(catalog.embeddingModels ?? []);
          setCatalogError(null);
        } else {
          setCatalogError("Unable to load the OpenRouter model catalog.");
        }
      } else {
        setCatalogError("Connect OpenRouter before choosing AI models.");
      }
      try {
        const tree = await listLocalVaultNotes(settings.vaultRootPath);
        setInboxFolders(tree.folders ?? []);
      } catch {
        setInboxFolders([]);
      }
    } catch {
      setLoadError(t`The local API is unavailable. Start the development services and try again.`);
    }
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  // Esc closes the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest("[data-keybinding-recorder]")) return;
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  async function save() {
    if (!s) return;
    setError(null);
    if (s.ingestionProvider === "claude-code" && !hasSelectedClaudeMemoryProfile(s.claudeIngestionModel, s.claudeEmbeddingModel)) {
      setError("Choose a Claude memory duo before saving.");
      return;
    }
    if (s.ingestionProvider === "claude-code" && !claudeStatus?.authenticated) {
      setError("Connect your Claude Code subscription before saving.");
      return;
    }
    setSaving(true);
    const requiresReindex = syncModelSignature(s) !== initialSyncSignature;
    const next = {
      ...s,
      vaultPath: s.vaultRootPath,
      vaultSourceLabel: VAULT_SOURCE_LABELS[s.vaultSourceType],
      ...(requiresReindex ? { syncStatus: "indexing" } : {}),
    };
    try {
      const res = await fetch(`${API}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const rawData = await res.json();
      if (!res.ok) {
        setError(rawData.error || t`Vault path must be an absolute existing folder.`);
        return;
      }
      const data = normalizeSettings(rawData);
      setS(data);
      const vaultKey = `${data.vaultSourceType}:${data.vaultRootPath}`;
      setInitialVaultKey(vaultKey);
      setInitialSyncSignature(syncModelSignature(data));
      props.onLocaleChange(data.locale || "en");
      props.onSettingsChange(data);
      window.dispatchEvent(new CustomEvent("sillage:conversation-model-change", {
        detail: {
          provider: data.ingestionProvider,
          model: data.ingestionProvider === "claude-code" ? data.claudeModel : data.defaultModel,
        },
      }));
      if (requiresReindex) {
        await invoke("restart_watcher", { token: props.accessToken, forceReindex: true });
      } else if (vaultKey !== initialVaultKey) {
        await invoke("pause_watcher");
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-0 z-50 flex bg-background"
    >
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-2 pb-3 pt-11">
        <button
          type="button"
          onClick={props.onClose}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <Icon name="arrow-left" className="text-[14px]" />
          <span>{t`Back to app`}</span>
        </button>

        <div className="mt-5 px-2 text-[12px] font-medium text-muted-foreground">{t`Personal`}</div>
        <button
          type="button"
          onClick={() => setSection("account")}
          className={cn(
            "mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
            section === "account"
              ? "bg-sidebar-accent text-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
          )}
        >
          <Icon name="user" className="text-[14px]" />
          <span>Account</span>
        </button>
        <button
          type="button"
          onClick={() => setSection("general")}
          className={cn(
            "mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
            section === "general"
              ? "bg-sidebar-accent text-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
          )}
        >
          <Icon name="gear-1" className="text-[14px]" />
          <span>{t`General`}</span>
        </button>
        <button
          type="button"
          onClick={() => setSection("ai-sync")}
          className={cn(
            "mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
            section === "ai-sync"
              ? "bg-sidebar-accent text-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
          )}
        >
          <BrainCircuit className="size-[14px]" />
          <span>AI &amp; Sync</span>
        </button>
        <button
          type="button"
          onClick={() => setSection("keybindings")}
          className={cn(
            "mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
            section === "keybindings"
              ? "bg-sidebar-accent text-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
          )}
        >
          <KeyboardIcon className="size-[14px]" />
          <span>Keyboard shortcuts</span>
        </button>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[780px] px-10 py-14">
          <h1 className="text-[22px] font-medium tracking-tight">
            {section === "account" ? "Account" : section === "general" ? t`General` : section === "ai-sync" ? "AI & Sync" : "Keyboard shortcuts"}
          </h1>
          {section === "account" ? (
            <AccountSettingsPanel profile={props.profile} />
          ) : section === "keybindings" ? (
            <KeyboardShortcutsSettings keybindings={props.keybindings} onChange={props.onKeybindingsChange} />
          ) : !s && loadError ? (
            <div className="mt-8 rounded-xl border border-destructive/35 bg-destructive/10 p-4">
              <p className="text-[13px] font-medium text-destructive">{t`Settings unavailable`}</p>
              <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{loadError}</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => void loadSettings()}>
                {t`Retry`}
              </Button>
            </div>
          ) : !s ? (
            <p className="mt-8 text-sm text-muted-foreground">{t`Loading...`}</p>
          ) : section === "ai-sync" ? (
            <div>
              <AiSyncSettingsPanel
                settings={s}
                models={models}
                embeddingModels={embeddingModels}
                catalogError={catalogError}
                onChange={setS}
                onClaudeStatusChange={setClaudeStatus}
              />
              {error && <p className="mt-4 text-xs text-destructive">{error}</p>}
            </div>
          ) : (
            <div className="mt-9 flex flex-col gap-9">
              <section>
                <h2 className="mb-2 text-[13px] font-medium">{t`Conversations`}</h2>
                <div className="rounded-xl border border-border bg-card px-4">
                  <div className="flex min-h-14 items-center justify-between gap-6 border-b border-border py-3">
                    <div>
                      <div className="text-[13px] font-medium">{t`Auto-delete archived chats`}</div>
                      <div className="mt-0.5 text-[12px] text-muted-foreground">
                        {t`Permanently remove archived conversations after a delay.`}
                      </div>
                    </div>
                    <Switch
                      checked={s.archiveAutoPurge}
                      onCheckedChange={(v) => setS({ ...s, archiveAutoPurge: v })}
                    />
                  </div>
                  <div className="flex min-h-14 items-center justify-between gap-6 border-b border-border py-3">
                    <div>
                      <div className="text-[13px] font-medium">{t`Deletion delay`}</div>
                      <div className="mt-0.5 text-[12px] text-muted-foreground">{t`Number of days before deletion.`}</div>
                    </div>
                    <Input
                      type="number"
                      min={1}
                      value={s.archivePurgeDays}
                      disabled={!s.archiveAutoPurge}
                      onChange={(e) => setS({ ...s, archivePurgeDays: Number(e.target.value) })}
                      className="h-8 w-20 text-right"
                    />
                  </div>
                  <div className="flex min-h-14 items-center justify-between gap-6 py-3">
                    <div>
                      <div className="text-[13px] font-medium">Conversation consolidation</div>
                      <div className="mt-0.5 text-[12px] text-muted-foreground">Choose what happens when a conversation is closed.</div>
                    </div>
                    <Select value={s.consolidationTrigger} onValueChange={(value) => setS({ ...s, consolidationTrigger: value as Settings["consolidationTrigger"] })}>
                      <SelectTrigger className="h-8 w-[190px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="off">Off</SelectItem>
                        <SelectItem value="ask_on_close">Ask when closing</SelectItem>
                        <SelectItem value="draft_automatically">Create draft automatically</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </section>

              <section>
                <h2 className="mb-2 text-[13px] font-medium">{t`Vault`}</h2>
                <div className="rounded-xl border border-border bg-card px-4">
                  {AVAILABLE_VAULT_SOURCES.length > 1 && (
                    <div className="flex min-h-14 items-center justify-between gap-6 border-b border-border py-3">
                      <div>
                        <div className="text-[13px] font-medium">{t`Vault source`}</div>
                        <div className="mt-0.5 text-[12px] text-muted-foreground">{t`Where Sillage reads your notes.`}</div>
                      </div>
                      <Select
                        value={AVAILABLE_VAULT_SOURCES.includes(s.vaultSourceType) ? s.vaultSourceType : "manual"}
                        onValueChange={(vaultSourceType) => {
                          if (!isVaultSourceType(vaultSourceType)) return;
                          if (!AVAILABLE_VAULT_SOURCES.includes(vaultSourceType)) return;
                          setS({
                            ...s,
                            vaultSourceType,
                            vaultSourceLabel: VAULT_SOURCE_LABELS[vaultSourceType],
                          });
                        }}
                      >
                        <SelectTrigger className="h-8 w-[190px]">
                          <SelectValue placeholder={t`Select vault source`} />
                        </SelectTrigger>
                        <SelectContent>
                          {AVAILABLE_VAULT_SOURCES.map((sourceType) => (
                            <SelectItem key={sourceType} value={sourceType}>
                              {VAULT_SOURCE_LABELS[sourceType]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="border-b border-border py-3">
                    <div className="text-[13px] font-medium">{t`Local vault folder`}</div>
                    <div className="mt-0.5 text-[12px] text-muted-foreground">
                      {t`Absolute path to the folder containing your notes.`}
                    </div>
                    <Input
                      type="text"
                      value={s.vaultRootPath}
                      placeholder={t`Absolute path to your Obsidian vault`}
                      onChange={(e) => setS({ ...s, vaultRootPath: e.target.value, vaultPath: e.target.value })}
                      className="mt-2 h-8"
                    />
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      {t`Sync status`}: {s.syncStatus || "unknown"}
                      {s.lastSyncCheckAt ? ` · ${new Date(s.lastSyncCheckAt).toLocaleString()}` : ""}
                    </div>
                    {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
                  </div>
                  <div className="flex min-h-14 items-center justify-between gap-6 py-3">
                    <div>
                      <div className="text-[13px] font-medium">Inbox folder</div>
                      <div className="mt-0.5 text-[12px] text-muted-foreground">
                        New knowledge drafts use this folder. Vault root is used temporarily if it disappears.
                      </div>
                      {!s.inboxFolderAvailable && <div className="mt-1 text-[11px] text-amber-500">Folder unavailable · currently using vault root</div>}
                    </div>
                    <Select value={s.inboxFolder || "__root__"} onValueChange={(value) => setS({ ...s, inboxFolder: value === "__root__" ? "" : value })}>
                      <SelectTrigger className="h-8 w-[220px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__root__">Vault root</SelectItem>
                        {inboxFolders.map((folder) => <SelectItem key={folder} value={folder}>{folder}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </section>

              <section>
                <h2 className="mb-2 text-[13px] font-medium">{t`General`}</h2>
                <div className="rounded-xl border border-border bg-card px-4">
                  <div className="flex min-h-14 items-center justify-between gap-6 py-3">
                    <div>
                      <div className="text-[13px] font-medium">{t`Language`}</div>
                      <div className="mt-0.5 text-[12px] text-muted-foreground">{t`Language used throughout the app.`}</div>
                    </div>
                    <Select value={s.locale} onValueChange={(locale) => setS({ ...s, locale })}>
                      <SelectTrigger className="h-8 w-[160px]">
                        <SelectValue placeholder={t`Select language`} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">{t`English`}</SelectItem>
                        <SelectItem value="fr">{t`French`}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </section>

            </div>
          )}
          {s && section !== "account" && section !== "keybindings" && (
            <div className="flex items-center justify-end gap-4 pb-8 pt-8">
              {section === "ai-sync" && s.ingestionProvider === "claude-code" && !claudeStatus?.authenticated && <p className="text-right text-[11px] text-muted-foreground">Connect Claude Code to save.</p>}
              {section === "ai-sync" && s.ingestionProvider === "claude-code" && claudeStatus?.authenticated && !hasSelectedClaudeMemoryProfile(s.claudeIngestionModel, s.claudeEmbeddingModel) && <p className="text-right text-[11px] text-muted-foreground">Choose a memory duo to save.</p>}
              <Button onClick={save} disabled={saving || (section === "ai-sync" && s.ingestionProvider === "claude-code" && (!claudeStatus?.authenticated || !hasSelectedClaudeMemoryProfile(s.claudeIngestionModel, s.claudeEmbeddingModel)))}>
                {saved ? t`Saved ✓` : saving ? "Saving…" : section === "ai-sync" && syncModelSignature(s) !== initialSyncSignature ? "Save & reindex vault" : t`Save changes`}
              </Button>
            </div>
          )}
        </div>
      </main>
    </motion.div>
  );
}
