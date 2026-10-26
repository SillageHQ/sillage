import { useEffect, useState, type ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { RotateCcw, X } from "lucide-react";
import { API_URL as API } from "@/lib/api";
import { cn } from "@/lib/utils";
import { shortcutFromEvent, shortcutLabel } from "@/lib/keybindings";
import { Button } from "@/components/ui/button";

type ArchivedItem = { id: string; title: string; archivedAt: string; folderId: string | null; daysLeft: number | null };
type ResurfaceItem = { uuid: string; name: string; degree: number; reminder: string };
type AppKeybindingAction = "magicMenu" | "newChat" | "nextTab" | "previousTab" | "toggleLeftSidebar" | "toggleRightSidebar";
type AppKeybindings = Record<AppKeybindingAction, string>;
const DEFAULT_KEYBINDINGS: AppKeybindings = { magicMenu: "Mod+K", newChat: "Mod+N", nextTab: "Control+Tab", previousTab: "Control+Shift+Tab", toggleLeftSidebar: "Mod+Shift+L", toggleRightSidebar: "Mod+Shift+R" };
const KEYBINDING_ACTIONS: Array<{ id: AppKeybindingAction; title: string; description: string }> = [
  { id: "magicMenu", title: t`Magic menu`, description: t`Open vault actions from anywhere in Sillage.` },
  { id: "newChat", title: "New chat", description: "Return to the home composer." },
  { id: "nextTab", title: "Next tab", description: "Activate the next open conversation." },
  { id: "previousTab", title: "Previous tab", description: "Activate the previous open conversation." },
  { id: "toggleLeftSidebar", title: "Toggle left sidebar", description: "Show or hide conversations and projects." },
  { id: "toggleRightSidebar", title: "Toggle vault sidebar", description: "Show or hide the Obsidian vault." },
];

export function PaneShell(props: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3.5 p-6">
        <h2 className="text-xl font-medium">{props.title}</h2>
        {props.children}
      </div>
    </div>
  );
}

export function Archive(props: { onRestore: () => void; onOpen: (id: string) => void }) {
  
  const [items, setItems] = useState<ArchivedItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    const data = await (await fetch(`${API}/conversations/archived`)).json();
    setItems(data.items);
    setLoaded(true);
  }
  useEffect(() => {
    load();
  }, []);

  async function restore(id: string) {
    await fetch(`${API}/conversations/${id}/unarchive`, { method: "POST" });
    setItems((it) => it.filter((i) => i.id !== id));
    props.onRestore();
  }
  async function remove(id: string) {
    await fetch(`${API}/conversations/${id}`, { method: "DELETE" });
    setItems((it) => it.filter((i) => i.id !== id));
  }

  return (
    <PaneShell title={t`Archive`}>
      {loaded && items.length === 0 && (
        <p className="mt-10 text-center text-muted-foreground">{t`No archived conversations.`}</p>
      )}
      {items.map((it) => (
        <div key={it.id} className="rounded-xl border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <strong className="cursor-pointer hover:text-primary" onClick={() => props.onOpen(it.id)}>
              {it.title}
            </strong>
            <span className="text-xs text-muted-foreground">
              {it.daysLeft !== null
                ? t`{days} days until deletion`.replace("{days}", String(it.daysLeft))
                : t`Archived on {date}`.replace("{date}", it.archivedAt.slice(0, 10))}
            </span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => restore(it.id)}>
              {t`Restore`}
            </Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => remove(it.id)}>
              {t`Delete`}
            </Button>
          </div>
        </div>
      ))}
    </PaneShell>
  );
}

export function KeyboardShortcutsSettings(props: {
  keybindings: AppKeybindings;
  onChange: (keybindings: AppKeybindings) => void;
}) {
  const [recording, setRecording] = useState<AppKeybindingAction | null>(null);

  function assign(action: AppKeybindingAction, shortcut: string) {
    const next = { ...props.keybindings };
    if (shortcut) {
      (Object.keys(next) as AppKeybindingAction[]).forEach((key) => {
        if (key !== action && next[key] === shortcut) next[key] = "";
      });
    }
    next[action] = shortcut;
    props.onChange(next);
    setRecording(null);
  }

  useEffect(() => {
    if (!recording) return;
    const captureShortcut = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        setRecording(null);
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        assign(recording, "");
        return;
      }
      const shortcut = shortcutFromEvent(event);
      if (shortcut) assign(recording, shortcut);
    };
    window.addEventListener("keydown", captureShortcut, true);
    return () => window.removeEventListener("keydown", captureShortcut, true);
  }, [recording, props.keybindings]);

  return (
    <div className="mt-9">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[13px] font-medium">Application shortcuts</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Click a shortcut, then press a new key combination. Duplicate shortcuts are reassigned automatically.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => props.onChange({ ...DEFAULT_KEYBINDINGS })}>
          <RotateCcw className="size-3.5" /> Reset defaults
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card px-4">
        {KEYBINDING_ACTIONS.map((action, index) => (
          <div
            key={action.id}
            className={cn(
              "flex min-h-16 items-center justify-between gap-6 py-3",
              index < KEYBINDING_ACTIONS.length - 1 && "border-b border-border",
            )}
          >
            <div className="min-w-0">
              <div className="text-[13px] font-medium">{action.title}</div>
              <div className="mt-0.5 text-[12px] text-muted-foreground">{action.description}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                data-keybinding-recorder
                onClick={() => setRecording(action.id)}
                className={cn(
                  "min-w-28 rounded-md border px-3 py-1.5 text-center font-mono text-[12px] transition-colors",
                  recording === action.id
                    ? "border-primary bg-primary/10 text-primary ring-2 ring-primary/15"
                    : "border-border bg-background text-foreground hover:border-muted-foreground/60",
                )}
              >
                {recording === action.id ? "Press shortcut…" : shortcutLabel(props.keybindings[action.id])}
              </button>
              <button
                type="button"
                onClick={() => assign(action.id, "")}
                title="Clear shortcut"
                aria-label={`Clear ${action.title} shortcut`}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Review() {
  
  const [items, setItems] = useState<ResurfaceItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const res = await fetch(`${API}/resurface?n=3`);
      setItems((await res.json()).items);
      setLoaded(true);
    } finally {
      setBusy(false);
    }
  }

  async function review(uuid: string, remembered: boolean) {
    await fetch(`${API}/resurface/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uuid, remembered }),
    });
    setItems((it) => it.filter((i) => i.uuid !== uuid));
  }

  return (
    <PaneShell title={t`Review`}>
      {!loaded ? (
        <Button className="mt-6 self-center" size="lg" onClick={load} disabled={busy}>
          {busy ? t`Searching...` : t`What should I review?`}
        </Button>
      ) : items.length === 0 ? (
        <p className="mt-10 text-center text-muted-foreground">{t`All caught up. ✨`}</p>
      ) : (
        items.map((it) => (
          <div key={it.uuid} className="rounded-xl border border-border bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <strong>{it.name}</strong>
              <span className="text-xs text-muted-foreground">{it.degree} links</span>
            </div>
            <p className="mb-3.5 leading-relaxed">{it.reminder}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => review(it.uuid, true)}>
                {t`I remembered`}
              </Button>
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => review(it.uuid, false)}>
                {t`Forgot`}
              </Button>
            </div>
          </div>
        ))
      )}
    </PaneShell>
  );
}
