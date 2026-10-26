// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REOPEN_UPDATE_TOAST_EVENT,
  UPDATE_BADGE_VISIBILITY_EVENT,
  type UpdateBadgeDetail,
  UpdateNotifier,
} from "./update-notifier";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
  downloadAndInstall: vi.fn(),
  close: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mocks.check,
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: mocks.relaunch,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

describe("UpdateNotifier", () => {
  afterEach(cleanup);

  beforeEach(() => {
    mocks.listen.mockReset();
    mocks.relaunch.mockReset().mockResolvedValue(undefined);
    mocks.close.mockReset().mockResolvedValue(undefined);
    mocks.downloadAndInstall.mockReset().mockImplementation(async (onEvent: (event: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 100 } });
      onEvent({ event: "Finished" });
    });
    mocks.check.mockReset().mockResolvedValue({
      currentVersion: "1.0.0-beta.1",
      version: "1.0.0-beta.2",
      downloadAndInstall: mocks.downloadAndInstall,
      close: mocks.close,
    });
  });

  it("checks from the system menu, installs the update, and relaunches Sillage", async () => {
    let checkFromMenu: (() => void) | undefined;
    mocks.listen.mockImplementation(async (_event: string, handler: () => void) => {
      checkFromMenu = handler;
      return vi.fn();
    });
    render(<UpdateNotifier enabled checkDelay={60_000} />);

    await waitFor(() => expect(checkFromMenu).toBeTypeOf("function"));
    await act(async () => checkFromMenu?.());
    expect(await screen.findByText("Version 1.0.0-beta.2 is available")).toBeTruthy();
    expect(mocks.check).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Install and restart" }));

    await waitFor(() => expect(mocks.downloadAndInstall).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.relaunch).toHaveBeenCalledOnce());
  });

  it("shows toast feedback when Sillage is already up to date", async () => {
    let checkFromMenu: (() => void) | undefined;
    mocks.check.mockResolvedValue(null);
    mocks.listen.mockImplementation(async (_event: string, handler: () => void) => {
      checkFromMenu = handler;
      return vi.fn();
    });
    render(<UpdateNotifier enabled autoCheck={false} />);

    await waitFor(() => expect(checkFromMenu).toBeTypeOf("function"));
    await act(async () => checkFromMenu?.());

    expect(await screen.findByText("You’re up to date")).toBeTruthy();
  });

  it("shows an alert toast when the update check fails", async () => {
    let checkFromMenu: (() => void) | undefined;
    mocks.check.mockRejectedValue(new Error("Update server unavailable"));
    mocks.listen.mockImplementation(async (_event: string, handler: () => void) => {
      checkFromMenu = handler;
      return vi.fn();
    });
    render(<UpdateNotifier enabled autoCheck={false} />);

    await waitFor(() => expect(checkFromMenu).toBeTypeOf("function"));
    await act(async () => checkFromMenu?.());

    expect(await screen.findByText("Update server unavailable")).toBeTruthy();
  });

  it("minimizes an available update to a badge and reopens it", async () => {
    let checkFromMenu: (() => void) | undefined;
    let badge: UpdateBadgeDetail | null = null;
    mocks.listen.mockImplementation(async (_event: string, handler: () => void) => {
      checkFromMenu = handler;
      return vi.fn();
    });
    const onBadgeVisibility = (event: Event) => {
      badge = (event as CustomEvent<UpdateBadgeDetail | null>).detail;
    };
    window.addEventListener(UPDATE_BADGE_VISIBILITY_EVENT, onBadgeVisibility);
    render(<UpdateNotifier enabled autoCheck={false} />);

    await waitFor(() => expect(checkFromMenu).toBeTypeOf("function"));
    await act(async () => checkFromMenu?.());
    fireEvent.click(await screen.findByRole("button", { name: "Later" }));

    await waitFor(() => expect(screen.queryByText("Version 1.0.0-beta.2 is available")).toBeNull());
    expect(badge).toEqual({ kind: "fix", version: "1.0.0-beta.2" });

    act(() => window.dispatchEvent(new Event(REOPEN_UPDATE_TOAST_EVENT)));
    expect(await screen.findByText("Version 1.0.0-beta.2 is available")).toBeTruthy();
    expect(badge).toBeNull();
    window.removeEventListener(UPDATE_BADGE_VISIBILITY_EVENT, onBadgeVisibility);
  });

  it("marks a minor release as a minor update badge", async () => {
    let checkFromMenu: (() => void) | undefined;
    let badge: UpdateBadgeDetail | null = null;
    mocks.check.mockResolvedValue({
      currentVersion: "1.0.0",
      version: "1.1.0",
      downloadAndInstall: mocks.downloadAndInstall,
      close: mocks.close,
    });
    mocks.listen.mockImplementation(async (_event: string, handler: () => void) => {
      checkFromMenu = handler;
      return vi.fn();
    });
    const onBadgeVisibility = (event: Event) => {
      badge = (event as CustomEvent<UpdateBadgeDetail | null>).detail;
    };
    window.addEventListener(UPDATE_BADGE_VISIBILITY_EVENT, onBadgeVisibility);
    render(<UpdateNotifier enabled autoCheck={false} />);

    await waitFor(() => expect(checkFromMenu).toBeTypeOf("function"));
    await act(async () => checkFromMenu?.());
    fireEvent.click(await screen.findByRole("button", { name: "Later" }));

    expect(badge).toEqual({ kind: "minor", version: "1.1.0" });
    window.removeEventListener(UPDATE_BADGE_VISIBILITY_EVENT, onBadgeVisibility);
  });
});
