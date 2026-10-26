import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";

let pendingUpdateCheck: Promise<Update | null> | null = null;
export const UPDATE_BADGE_VISIBILITY_EVENT = "sillage:update-badge-visibility";
export const REOPEN_UPDATE_TOAST_EVENT = "sillage:reopen-update-toast";
export type UpdateBadgeDetail = {
  kind: "fix" | "minor";
  version: string;
};

function updateKind(currentVersion: string, nextVersion: string): UpdateBadgeDetail["kind"] {
  const current = currentVersion.split("-", 1)[0].split(".").map(Number);
  const next = nextVersion.split("-", 1)[0].split(".").map(Number);
  return next[0] > current[0] || next[1] > current[1] ? "minor" : "fix";
}

function setUpdateBadge(update: Update | null) {
  const detail: UpdateBadgeDetail | null = update
    ? { kind: updateKind(update.currentVersion, update.version), version: update.version }
    : null;
  window.dispatchEvent(new CustomEvent(UPDATE_BADGE_VISIBILITY_EVENT, { detail }));
}

function checkForUpdate(force = false) {
  if (force) pendingUpdateCheck = null;
  if (!pendingUpdateCheck) {
    pendingUpdateCheck = check({ timeout: 15_000 });
  }
  return pendingUpdateCheck;
}

function installLabel(downloadedBytes: number, totalBytes: number | null, downloadFinished: boolean) {
  if (downloadFinished) return "Installing update…";
  if (!totalBytes) return "Downloading update…";
  return `Downloading ${Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))}%…`;
}

export function UpdateNotifier({
  enabled = true,
  autoCheck = import.meta.env.PROD,
  checkDelay = 2_000,
}: {
  enabled?: boolean;
  autoCheck?: boolean;
  checkDelay?: number;
}) {
  const [update, setUpdate] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);
  const [downloadFinished, setDownloadFinished] = useState(false);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [checkStatus, setCheckStatus] = useState<"checking" | "current" | "failed" | null>(null);
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    if (!enabled || !autoCheck) return;
    let active = true;
    const timeout = window.setTimeout(() => {
      void checkForUpdate().then((availableUpdate) => {
        if (active && availableUpdate) {
          setUpdate(availableUpdate);
          setMinimized(false);
          setUpdateBadge(null);
        }
      }).catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Could not check for updates.");
        setCheckStatus("failed");
      });
    }, checkDelay);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [autoCheck, checkDelay, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let unlisten: (() => void) | undefined;
    void listen("check-for-updates", () => {
      setCheckStatus("checking");
      setError("");
      void checkForUpdate(true)
        .then((availableUpdate) => {
          setUpdate(availableUpdate);
          setMinimized(false);
          setUpdateBadge(null);
          setCheckStatus(availableUpdate ? null : "current");
        })
        .catch((reason) => {
          setError(reason instanceof Error ? reason.message : "Could not check for updates.");
          setCheckStatus("failed");
        });
    }).then((stopListening) => {
      unlisten = stopListening;
    });
    return () => unlisten?.();
  }, [enabled]);

  useEffect(() => {
    const reopen = () => {
      if (!update) return;
      setMinimized(false);
      setUpdateBadge(null);
    };
    window.addEventListener(REOPEN_UPDATE_TOAST_EVENT, reopen);
    return () => window.removeEventListener(REOPEN_UPDATE_TOAST_EVENT, reopen);
  }, [update]);

  useEffect(() => {
    if (update || checkStatus === "checking" || !checkStatus) return;
    const timeout = window.setTimeout(() => {
      setCheckStatus(null);
      setError("");
    }, checkStatus === "failed" ? 7_000 : 4_000);
    return () => window.clearTimeout(timeout);
  }, [checkStatus, update]);

  if ((!update && !checkStatus) || minimized) return null;

  function trackDownload(event: DownloadEvent) {
    if (event.event === "Started") {
      setDownloadedBytes(0);
      setTotalBytes(event.data.contentLength ?? null);
    } else if (event.event === "Progress") {
      setDownloadedBytes((current) => current + event.data.chunkLength);
    } else {
      setDownloadFinished(true);
    }
  }

  async function installUpdate() {
    if (!update) return;
    setInstalling(true);
    setError("");
    try {
      await update.downloadAndInstall(trackDownload, { timeout: 10 * 60_000 });
      setUpdateBadge(null);
      await relaunch();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The update could not be installed.");
      setInstalling(false);
      setDownloadFinished(false);
    }
  }

  function dismiss() {
    if (update) {
      setMinimized(true);
      setUpdateBadge(update);
      return;
    }
    setUpdate(null);
    setCheckStatus(null);
    setError("");
  }

  const title = update
    ? `Version ${update.version} is available`
    : checkStatus === "checking"
      ? "Checking for updates…"
      : checkStatus === "current"
        ? "You’re up to date"
        : "Unable to check for updates";
  const description = update
    ? "Install the latest version. The app will restart automatically."
    : checkStatus === "checking"
      ? "Looking for the latest Sillage release."
      : checkStatus === "current"
        ? "You already have the latest available version."
        : "Check your connection and try again.";

  return (
    <aside
      role={error ? "alert" : "status"}
      aria-live={error ? "assertive" : "polite"}
      className="fixed bottom-5 right-5 z-[100] w-[min(390px,calc(100vw-2.5rem))] rounded-2xl border border-white/10 bg-[#171718]/98 p-4 text-white shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          {checkStatus === "checking" && !update && (
            <span className="size-4 animate-spin rounded-full border-2 border-white/20 border-t-white/80" aria-hidden="true" />
          )}
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        <p className="mt-1.5 text-sm leading-6 text-white/55">
          {description}
        </p>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-red-300/15 bg-red-300/5 px-3 py-2 text-xs leading-5 text-red-200" role="alert">
          {error}
        </p>
      )}

      <div className="mt-5 flex items-center justify-end gap-2">
        {update ? (
          <>
            <button
              type="button"
              disabled={installing}
              onClick={dismiss}
              className="rounded-lg px-3 py-2 text-sm font-medium text-white/45 transition hover:bg-white/5 hover:text-white/70 disabled:opacity-40"
            >
              Later
            </button>
            <button
              type="button"
              disabled={installing}
              onClick={() => void installUpdate()}
              className="min-w-36 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-wait disabled:opacity-70"
            >
              {installing ? installLabel(downloadedBytes, totalBytes, downloadFinished) : "Install and restart"}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={checkStatus === "checking"}
            onClick={dismiss}
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-wait disabled:opacity-50"
          >
            Done
          </button>
        )}
      </div>
    </aside>
  );
}
