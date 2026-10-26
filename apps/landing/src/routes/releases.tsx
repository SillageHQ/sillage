import { createFileRoute } from "@tanstack/react-router";
import { BrandMark, Wordmark } from "../components/brand";
import { getReleaseCatalog, type ReleaseArtifact } from "../lib/releases";
import { trackEvent } from "../lib/analytics";

export const Route = createFileRoute("/releases")({
  loader: () => getReleaseCatalog(),
  head: () => ({
    meta: [
      { title: "Releases — Sillage" },
      { name: "description", content: "Download current and previous versions of the Sillage desktop application." },
    ],
  }),
  component: ReleasesPage,
});

function platformLabel(artifact: ReleaseArtifact) {
  if (artifact.platform === "darwin") return "macOS";
  if (artifact.platform === "linux") return "Linux";
  if (artifact.platform === "windows") return "Windows";
  return artifact.platform;
}

function formatLabel(format: string) {
  if (format === "dmg") return "DMG";
  if (format === "appimage") return "AppImage";
  return format.toUpperCase();
}

function formatBytes(value: number) {
  if (value < 1_024 * 1_024) return `${Math.max(1, Math.round(value / 1_024))} KB`;
  return `${(value / (1_024 * 1_024)).toFixed(1)} MB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function ReleasesPage() {
  const catalog = Route.useLoaderData();

  return (
    <div className="releases-page">
      <header className="topbar releases-topbar">
        <a href="/" aria-label="Sillage home"><Wordmark /></a>
        <p>Desktop application archive</p>
        <a className="top-link" href="/">Back to Sillage <span aria-hidden="true">↗</span></a>
      </header>

      <main>
        <section className="releases-hero">
          <div className="releases-hero-mark"><BrandMark /></div>
          <p className="section-index">SILLAGE — RELEASES</p>
          <h1>Every version.<br /><em>One trail.</em></h1>
          <p>Download the latest build or return to an earlier release. Every artifact includes its original SHA-256 checksum.</p>
        </section>

        <section className="release-catalog" id="latest">
          <div className="release-catalog-heading">
            <p className="section-index">DESKTOP BUILDS</p>
            <p>{catalog.releases.length} {catalog.releases.length === 1 ? "release" : "releases"} available</p>
          </div>

          {!catalog.available ? (
            <div className="release-empty">
              <h2>The release archive is temporarily unavailable.</h2>
              <p>Try again shortly or contact <a href="mailto:hello@sillagehq.app">hello@sillagehq.app</a>.</p>
            </div>
          ) : catalog.releases.length === 0 ? (
            <div className="release-empty">
              <h2>No public release yet.</h2>
              <p>Join the private beta to be notified when the first build is available.</p>
            </div>
          ) : (
            <ol className="release-list">
              {catalog.releases.map((release, index) => (
                <li key={release.version} className="release-entry">
                  <div className="release-version">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <h2>v{release.version}</h2>
                      <p>
                        <time dateTime={release.publishedAt}>{formatDate(release.publishedAt)}</time>
                        <span>{release.channel}</span>
                        {index === 0 && <b>Latest</b>}
                      </p>
                    </div>
                  </div>

                  <div className="release-artifacts">
                    {release.artifacts.map((artifact) => (
                      <a
                        key={`${artifact.platform}-${artifact.arch}-${artifact.format}`}
                        className="release-download"
                        href={artifact.downloadUrl ?? undefined}
                        aria-disabled={!artifact.downloadUrl}
                        onClick={() => artifact.downloadUrl && trackEvent("desktop_downloaded", { platform: platformLabel(artifact), version: release.version })}
                      >
                        <span>
                          <b>{platformLabel(artifact)}</b>
                          <small>{artifact.arch} · {formatLabel(artifact.format)} · {formatBytes(artifact.size)}</small>
                        </span>
                        <span className="release-download-action">Download <i aria-hidden="true">↓</i></span>
                        <code title={artifact.sha256}>SHA-256 {artifact.sha256}</code>
                      </a>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>

      <footer className="releases-footer">
        <Wordmark />
        <p>Keep the version that works for you.</p>
        <div>
          <a href="/privacy">Privacy</a>
          <a href="/tos">Terms</a>
          <a href="mailto:hello@sillagehq.app">Support</a>
        </div>
      </footer>
    </div>
  );
}
