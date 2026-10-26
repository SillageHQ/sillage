export type AppTheme = "dark" | "light";

const DEFAULT_ACCENT = "#6F8CFF";

function contrastingText(hex: string) {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue > 0.45 ? "#111113" : "#FFFFFF";
}

export function applyAppearance(theme: AppTheme = "dark", accentColor = DEFAULT_ACCENT) {
  const root = document.documentElement;
  const accent = /^#[0-9a-f]{6}$/i.test(accentColor) ? accentColor : DEFAULT_ACCENT;
  root.classList.toggle("dark", theme === "dark");
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.style.setProperty("--primary", accent);
  root.style.setProperty("--primary-foreground", contrastingText(accent));
  root.style.setProperty("--ring", accent);
  root.style.setProperty("--sidebar-primary", accent);
}

applyAppearance();
