export type ShortcutEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

export function isMacPlatform(platform = typeof navigator === "undefined" ? "" : navigator.platform): boolean {
  return /Mac|iPhone|iPad/.test(platform);
}

export function shortcutFromEvent(event: ShortcutEvent, platform?: string): string | null {
  if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) return null;
  const parts: string[] = [];
  const mac = isMacPlatform(platform);
  if (event.metaKey || (event.ctrlKey && !mac)) parts.push("Mod");
  else if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  const aliases: Record<string, string> = {
    " ": "Space",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    ArrowUp: "Up",
    ArrowDown: "Down",
  };
  const key = aliases[event.key] || (event.key.length === 1 ? event.key.toUpperCase() : event.key);
  parts.push(key);
  return parts.join("+");
}

export function shortcutLabel(shortcut: string, platform?: string): string {
  if (!shortcut) return "Not set";
  const labels: Record<string, string> = {
    Mod: isMacPlatform(platform) ? "⌘" : "Ctrl",
    Control: "⌃",
    Alt: "⌥",
    Shift: "⇧",
    Tab: "⇥",
    Enter: "↩",
    Backspace: "⌫",
    Escape: "Esc",
    Left: "←",
    Right: "→",
    Up: "↑",
    Down: "↓",
  };
  return shortcut.split("+").map((part) => labels[part] || part).join(" ");
}
