import { authClient } from "./lib/auth-client";
import { BrandMark, Wordmark } from "./components/brand";
import { useState, type FormEvent, type ReactNode } from "react";
import { joinBetaWaitlist } from "./lib/waitlist";
import { useTurnstileToken, WaitlistTurnstile } from "./lib/turnstile";
import { type ReleaseArtifact, type ReleaseCatalog } from "./lib/releases";
import { trackEvent } from "./lib/analytics";

const productScreenshots = import.meta.glob("./assets/screenshots/*.webp", {
  eager: true,
  import: "default",
  query: "?url",
}) as Record<string, string>;

function Arrow() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 10h15M12 4l6 6-6 6" /></svg>;
}

function AccountAccess({ dark = false }: { dark?: boolean }) {
  const { data: session, isPending } = authClient.useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");
  const { turnstileRef, getTurnstileToken, resetTurnstile } = useTurnstileToken();

  async function joinWaitlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setError("");
    try {
      const turnstileToken = await getTurnstileToken();
      await joinBetaWaitlist({ data: { name, email, website, turnstileToken } });
      trackEvent("waitlist_joined");
      resetTurnstile();
      setStatus("done");
      setName("");
      setEmail("");
    } catch (reason) {
      setStatus("idle");
      resetTurnstile();
      setError(reason instanceof Error ? reason.message : "The waitlist is temporarily unavailable");
    }
  }

  return (
    <div className={`waitlist account-access${dark ? " waitlist-dark" : ""}`}>
      <label>Private beta</label>
      {!isPending && !session && (status === "done" ? (
        <div className="waitlist-confirmation" role="status">
          <p>You’re on the list.</p>
          <small>Watch your inbox for your private beta invitation.</small>
        </div>
      ) : (
        <>
          <form className="waitlist-form" onSubmit={joinWaitlist}>
            <div className="waitlist-name-row">
              <input
                type="text"
                name="name"
                autoComplete="name"
                placeholder="Full name"
                aria-label="Full name"
                required
                minLength={2}
                maxLength={120}
                disabled={status === "sending"}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="waitlist-email-row">
              <input
                type="email"
                name="email"
                autoComplete="email"
                placeholder="you@example.com"
                aria-label="Email address"
                required
                disabled={status === "sending"}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <button type="submit" aria-label="Join the private beta" disabled={status === "sending"}>
                {status === "sending" ? <span className="sending" aria-hidden="true">•••</span> : <Arrow />}
              </button>
            </div>
            <label className="form-trap" aria-hidden="true">
              Website
              <input
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
              />
            </label>
            <WaitlistTurnstile turnstileRef={turnstileRef} dark={dark} />
          </form>
          {error && <p className="waitlist-error" role="alert">{error}</p>}
          <small>
            Join the waitlist. By joining, you agree to receive beta emails and acknowledge our{" "}
            <a href="/privacy">Privacy Policy</a>. <a href="/sign-up">Activate your access</a> / <a href="/sign-in">Log in</a>.
          </small>
        </>
      ))}
      {session && (
        <div className="signed-in-access">
          <a href="/account">Open your account <Arrow /></a>
          <button onClick={() => void authClient.signOut()}>Sign out</button>
        </div>
      )}
    </div>
  );
}

function WakeLine({ className = "" }: { className?: string }) {
  return (
    <svg className={`wake-line ${className}`} viewBox="0 0 1600 680" preserveAspectRatio="none" aria-hidden="true">
      <path className="wake-ghost" d="M-70 590C250 575 365 160 705 330c315 157 400-145 965-235" />
      <path d="M-80 558C225 548 350 128 700 298c325 157 405-142 980-230" />
    </svg>
  );
}

function ProductShot({
  src,
  alt,
  className = "",
  children,
}: {
  src?: string;
  alt: string;
  className?: string;
  children: ReactNode;
}) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className={`product-shot ${className}${loaded ? " has-image" : ""}`}>
      <div className="product-shot-fallback" aria-hidden={loaded}>
        {children}
      </div>
      {src && <img src={src} alt={alt} onLoad={() => setLoaded(true)} />}
    </div>
  );
}

function RecallPreview() {
  return (
    <div className="preview-app preview-recall">
      <div className="preview-sidebar">
        <b>Sillage</b>
        <span>New chat</span>
        <span>Review</span>
        <span>Archive</span>
        <small>CHATS</small>
        <span className="is-active">Life & work</span>
      </div>
      <div className="preview-thread">
        <div className="preview-question">How close am I to becoming financially independent?</div>
        <div className="preview-answer">
          <p>Your Shopify projects are the clearest path in your notes. Sillage is nearing beta, while Atlas still needs its first paying users.</p>
          <span>1&nbsp;&nbsp; goals/financial-independence.md</span>
          <span>2&nbsp;&nbsp; projects/shopify/sillage.md</span>
        </div>
        <div className="preview-composer">Talk to Sillage…</div>
      </div>
      <div className="preview-vault">
        <b>Vault</b>
        <span>00 — Inbox</span>
        <span>Projects</span>
        <span>Research</span>
        <span>Writing</span>
      </div>
    </div>
  );
}

function SourcePreview() {
  return (
    <div className="preview-app preview-source">
      <div className="preview-note">
        <small>MEMORY USED IN THIS ANSWER</small>
        <h3>July 1 — Product meeting</h3>
        <p>“Maya wants us to test onboarding before adding another integration.”</p>
        <span>meetings/2026-07-01-product.md · lines 18–21</span>
      </div>
    </div>
  );
}

function ReviewPreview() {
  return (
    <div className="preview-app preview-review">
      <div className="review-heading"><span>Save to memory</span><small>CONVERSATION SUMMARY</small></div>
      <div className="review-row"><b>Decision</b><span>Test onboarding before integrations</span></div>
      <div className="review-row"><b>Next step</b><span>Recruit five non-technical beta users</span></div>
      <div className="review-row"><b>Destination</b><span>projects/sillage.md</span></div>
    </div>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.26.07 2.14.69 2.88.74 1.11-.23 2.17-.89 3.35-.8 1.42.12 2.49.67 3.2 1.7-2.93 1.76-2.23 5.62.45 6.7-.54 1.42-1.24 2.84-1.88 4.63ZM12.03 7.25C11.88 5.14 13.6 3.4 15.57 3.23c.27 2.44-2.22 4.26-3.54 4.02Z" />
    </svg>
  );
}

function LinuxIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.4c-3.08 0-4.72 2.78-4.72 6.08 0 1.28-.18 2.04-.72 3.08-.56 1.08-1.56 2.56-1.56 4.28 0 1.25.67 2.18 1.75 2.18.68 0 1.22-.32 1.65-.75.58 2.08 1.79 3.33 3.6 3.33s3.02-1.25 3.6-3.33c.43.43.97.75 1.65.75 1.08 0 1.75-.93 1.75-2.18 0-1.72-1-3.2-1.56-4.28-.54-1.04-.72-1.8-.72-3.08 0-3.3-1.64-6.08-4.72-6.08Zm-1.66 4.5c.43 0 .78.44.78.98s-.35.98-.78.98-.78-.44-.78-.98.35-.98.78-.98Zm3.32 0c.43 0 .78.44.78.98s-.35.98-.78.98-.78-.44-.78-.98.35-.98.78-.98ZM12 9.1l1.35 1.06L12 11.22l-1.35-1.06L12 9.1Zm0 3.18c1.78 0 3.2 1.84 3.2 4.1 0 2.25-1.16 3.44-3.2 3.44s-3.2-1.19-3.2-3.44c0-2.26 1.42-4.1 3.2-4.1Z" />
    </svg>
  );
}

function WindowsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 5.2 10.8 4v7H3V5.2Zm9.2-1.43L21 2.5V11h-8.8V3.77ZM3 13h7.8v7L3 18.8V13Zm9.2 0H21v8.5l-8.8-1.27V13Z" />
    </svg>
  );
}

function PlatformDownload({
  artifact,
  artifacts,
  platform,
  icon,
}: {
  artifact?: ReleaseArtifact;
  artifacts?: ReleaseArtifact[];
  platform: string;
  icon: ReactNode;
}) {
  const availableArtifacts = (artifacts ?? (artifact ? [artifact] : [])).filter((item) => item.downloadUrl);
  const content = (
    <>
      <span className="download-platform-icon">{icon}</span>
      <span>
        <small>Download for</small>
        <b>{platform}</b>
      </span>
      <i aria-hidden="true">↓</i>
    </>
  );

  if (platform === "Linux" && availableArtifacts.length > 1) {
    return (
      <div className="download-platform download-platform-menu" role="group" aria-label="Download for Linux">
        {content}
        <div className="download-platform-options">
          <small>Choose a package</small>
          {availableArtifacts.map((item) => (
            <a
              key={item.format}
              href={item.downloadUrl ?? undefined}
              onClick={() => trackEvent("desktop_downloaded", { platform, format: item.format })}
            >
              <span>{item.format === "appimage" ? ".AppImage" : ".deb"}</span>
              <i aria-hidden="true">↓</i>
            </a>
          ))}
        </div>
      </div>
    );
  }

  return artifact?.downloadUrl ? (
    <a className="download-platform" href={artifact.downloadUrl} onClick={() => trackEvent("desktop_downloaded", { platform })}>{content}</a>
  ) : (
    <span className="download-platform is-unavailable" aria-disabled="true" title={`${platform} build unavailable`}>
      {content}
    </span>
  );
}

function getLatestPlatformArtifacts(catalog: ReleaseCatalog) {
  const latestMacRelease = catalog.releases.find((release) => (
    release.artifacts.some((artifact) => artifact.platform === "darwin" && artifact.downloadUrl)
  ));
  const latestLinuxRelease = catalog.releases.find((release) => (
    release.artifacts.some((artifact) => artifact.platform === "linux" && artifact.downloadUrl)
  ));
  const latestWindowsRelease = catalog.releases.find((release) => (
    release.artifacts.some((artifact) => artifact.platform === "windows" && artifact.downloadUrl)
  ));

  return {
    macArtifact: latestMacRelease?.artifacts.find((artifact) => artifact.platform === "darwin" && artifact.downloadUrl),
    linuxArtifacts: latestLinuxRelease?.artifacts.filter((artifact) => (
      artifact.platform === "linux" && artifact.downloadUrl && (artifact.format === "appimage" || artifact.format === "deb")
    )),
    linuxArtifact: latestLinuxRelease?.artifacts.find((artifact) => (
      artifact.platform === "linux" && artifact.format === "appimage" && artifact.downloadUrl
    )) ?? latestLinuxRelease?.artifacts.find((artifact) => artifact.platform === "linux" && artifact.downloadUrl),
    windowsArtifact: latestWindowsRelease?.artifacts.find((artifact) => (
      artifact.platform === "windows" && artifact.format === "nsis" && artifact.downloadUrl
    )) ?? latestWindowsRelease?.artifacts.find((artifact) => artifact.platform === "windows" && artifact.downloadUrl),
  };
}

export default function App({ releaseCatalog }: { releaseCatalog: ReleaseCatalog }) {
  const { macArtifact, linuxArtifact, linuxArtifacts, windowsArtifact } = getLatestPlatformArtifacts(releaseCatalog);

  return (
    <>
      <header className="topbar landing-topbar">
        <a href="#top" aria-label="Sillage home"><Wordmark /></a>
        <a className="top-link" href="#access">Join the private beta <Arrow /></a>
      </header>

      <main>
        <section className="customer-hero" id="top">
          <WakeLine className="customer-hero-wake" />

          <div className="customer-hero-copy">
            <h1>
              <span>Your notes.</span>
              <em>Now part of every</em>
              <span>conversation.</span>
            </h1>
            <p className="hero-lede">
              Sillage is an AI workspace with a verifiable memory built from your Obsidian notes. As you talk, it brings the right context into the conversation and shows where it came from.
            </p>
            <div className="hero-downloads" aria-label="Download the latest Sillage beta">
              <PlatformDownload artifact={macArtifact} platform="macOS" icon={<AppleIcon />} />
              <PlatformDownload artifact={linuxArtifact} artifacts={linuxArtifacts} platform="Linux" icon={<LinuxIcon />} />
              <PlatformDownload artifact={windowsArtifact} platform="Windows" icon={<WindowsIcon />} />
            </div>
            <a className="hero-release-link" href="/releases">Browse every release <span aria-hidden="true">↗</span></a>
          </div>

          <aside className="customer-hero-access">
            <AccountAccess />
          </aside>

        </section>

        <section className="pain" id="problem">
          <div className="pain-heading">
            <p className="section-index">02 — THE PROBLEM</p>
            <h2>Every new AI conversation<br />starts from zero.</h2>
          </div>

          <p className="pain-intro">
            Your notes hold years of decisions, ideas, meetings, and unfinished work. But the AI you talk to still needs you to explain your life all over again.
          </p>

          <div className="pain-grid">
            <article>
              <span>01</span>
              <h3>Your AI does not know your history.</h3>
              <p>It can answer brilliantly while missing the decisions and experiences that make the answer yours.</p>
            </article>
            <article>
              <span>02</span>
              <h3>You have to rebuild the context yourself.</h3>
              <p>Find the right notes, paste the useful parts, and explain every project before the real conversation can begin.</p>
            </article>
            <article>
              <span>03</span>
              <h3>The useful memory is often the one you did not ask for.</h3>
              <p>You cannot search for a connection you do not yet know is relevant.</p>
            </article>
          </div>
        </section>

        <section className="product-story" id="product">
          <div className="product-story-heading">
            <p className="section-index">03 — THE CONVERSATION</p>
            <h2>Talk normally.<br /><em>Sillage remembers.</em></h2>
            <p>
              Ask about a note directly, or simply talk about what matters now. Sillage decides when your history is relevant and brings it into the answer.
            </p>
          </div>

          <figure className="product-figure product-figure-main">
            <div className="product-figure-meta">
              <span>01 / CONTEXTUAL RECALL</span>
              <p>You mention a goal. Sillage recognizes the projects in your notes that move it forward.</p>
            </div>
            <ProductShot
              src={productScreenshots["./assets/screenshots/sillage-recall.webp"]}
              alt="Sillage using relevant Shopify project notes to answer a question about financial independence"
              className="product-shot-main"
            >
              <RecallPreview />
            </ProductShot>
          </figure>

          <div className="product-figure-grid">
            <figure className="product-figure">
              <div className="product-figure-meta">
                <span>02 / EXPLICIT RECALL</span>
                <p>Ask what someone said in a meeting and follow the answer back to the exact note.</p>
              </div>
              <ProductShot
                src={productScreenshots["./assets/screenshots/sillage-source.webp"]}
                alt="A meeting note used by Sillage with its original file path and line numbers"
              >
                <SourcePreview />
              </ProductShot>
            </figure>
            <figure className="product-figure product-figure-offset">
              <div className="product-figure-meta">
                <span>03 / DURABLE MEMORY</span>
                <p>Choose what a conversation should add to your notes. Nothing becomes permanent behind your back.</p>
              </div>
              <ProductShot
                src={productScreenshots["./assets/screenshots/sillage-review.webp"]}
                alt="Sillage preparing a conversation summary to save into an Obsidian note"
              >
                <ReviewPreview />
              </ProductShot>
            </figure>
          </div>
        </section>

        <section className="outcomes" id="outcomes">
          <div className="outcomes-heading">
            <p className="section-index">04 — TWO WAYS TO REMEMBER</p>
            <h2>Ask for it.<br />Or don’t.</h2>
          </div>

          <div className="outcome-list">
            <article>
              <span>EXPLICIT RECALL</span>
              <h3>“What did Maya say in our July 1 meeting?”</h3>
              <p>Sillage searches your memory because you asked it to.</p>
            </article>
            <article>
              <span>CONTEXTUAL RECALL</span>
              <h3>“How close am I to becoming financially independent?”</h3>
              <p>Sillage understands that your Shopify projects are part of the answer—even when you never mention them.</p>
            </article>
            <article>
              <span>VERIFIABLE BY DESIGN</span>
              <h3>Memory you can question, not just trust.</h3>
              <p>Open the original Markdown behind a claim and decide for yourself.</p>
            </article>
          </div>
        </section>

        <section className="method" id="how">
          <div className="method-heading">
            <p className="section-index">05 — HOW IT WORKS</p>
            <h2>One desktop app.<br />No infrastructure.</h2>
          </div>
          <ol>
            <li><span>01</span><h3>Download Sillage</h3><p>Install the desktop app on macOS, Linux, or Windows. No Docker, command line, or retrieval system to configure.</p></li>
            <li><span>02</span><h3>Connect your Obsidian vault</h3><p>Keep your existing folders, links, frontmatter, and habits while Sillage prepares your notes for conversation.</p></li>
            <li><span>03</span><h3>Make it your AI workspace</h3><p>Use Sillage for your everyday AI conversations. Ask naturally; the right notes enter the conversation when they matter.</p></li>
          </ol>
        </section>

        <section className="boundaries" id="privacy">
          <div className="boundaries-copy">
            <p className="section-index">06 — THE MEMORY CONTRACT</p>
            <h2>Hide the machinery.<br />Never the evidence.</h2>
            <p>Sillage makes remembering effortless without turning memory into a black box. Your notes remain the durable record, and every answer can lead back to them.</p>
          </div>
          <dl>
            <div><dt>01</dt><dd><b>Your notes are durable memory</b><span>Markdown stays readable, portable, and useful without Sillage.</span></dd></div>
            <div><dt>02</dt><dd><b>Conversation is working memory</b><span>A chat does not silently become a permanent truth. You choose what gets saved.</span></dd></div>
            <div><dt>03</dt><dd><b>Sources stay visible</b><span>See which notes shaped an answer and open the original context whenever you need it.</span></dd></div>
          </dl>
        </section>

        <section className="access" id="access">
          <WakeLine className="access-wake" />
          <div className="access-mark"><BrandMark /></div>
          <p className="section-index">07 — PRIVATE BETA</p>
          <div className="access-copy">
            <h2>A workspace<br />that remembers.</h2>
            <p>Join the private beta and help build a conversational workspace that starts with your context—not an empty window.</p>
          </div>
          <div className="access-form"><AccountAccess dark /></div>
        </section>
      </main>

      <footer>
        <Wordmark />
        <p>Your notes. Now part of every conversation.</p>
        <div>
          <a href="/privacy">Privacy</a>
          <a href="/tos">Terms</a>
          <a href="mailto:hello@sillagehq.app">hello@sillagehq.app</a>
          <span>© {new Date().getFullYear()}</span>
        </div>
      </footer>
    </>
  );
}
