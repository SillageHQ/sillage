// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { MagicMenu } from "./magic-menu";

describe("MagicMenu", () => {
  beforeEach(() => {
    i18n.load("en", {});
    i18n.activate("en");
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(url.endsWith("/settings")
        ? { resolvedInboxFolder: "1. INBOX" }
        : { items: [], folders: ["Ideas"] }),
    })));
  });

  it("opens as an accessible action palette", async () => {
    render(
      <I18nProvider i18n={i18n}>
        <MagicMenu open onClose={vi.fn()} onCreated={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByRole("dialog", { name: "Magic menu" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Organize a folder/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Structure an idea/i })).toBeTruthy();
  });
});
