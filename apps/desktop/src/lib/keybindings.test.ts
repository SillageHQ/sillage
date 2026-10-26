import { describe, expect, it } from "vitest";
import { shortcutFromEvent, shortcutLabel } from "./keybindings";

const event = (overrides: Partial<Parameters<typeof shortcutFromEvent>[0]> = {}) => ({
  key: "k",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
});

describe("cross-platform keybindings", () => {
  it("normalizes Command+K to Mod+K on macOS", () => {
    expect(shortcutFromEvent(event({ metaKey: true }), "MacIntel")).toBe("Mod+K");
    expect(shortcutLabel("Mod+K", "MacIntel")).toBe("⌘ K");
  });

  it("normalizes Ctrl+K to Mod+K on Windows", () => {
    expect(shortcutFromEvent(event({ ctrlKey: true }), "Win32")).toBe("Mod+K");
    expect(shortcutLabel("Mod+K", "Win32")).toBe("Ctrl K");
  });

  it("keeps physical Control distinct on macOS", () => {
    expect(shortcutFromEvent(event({ ctrlKey: true }), "MacIntel")).toBe("Control+K");
  });
});
