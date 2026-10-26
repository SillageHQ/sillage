import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import type { VaultNote } from "@/components/vault-explorer";
import type { CitationAnchor } from "@/components/obsidian-markdown";

export function pathBase(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

export function markdownLabel(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, alias?: string) => alias || target)
    .replace(/<\/?(?:u|strong|b|em|i|mark|span)(?:\s[^>]*)?>/gi, "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function obsidianUrl(vaultPath: string, notePath: string | null, noteTitle?: string | null): string | null {
  const vault = pathBase(vaultPath);
  const file = notePath || noteTitle || "";
  if (!vault || !file) return null;
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(file)}`;
}

export function openObsidianLink(href: string) {
  void invoke("open_obsidian_url", { href }).catch(() => {
    window.open(href, "_blank", "noreferrer");
  });
}

export function openExternalLink(href: string) {
  void invoke("open_obsidian_url", { href }).catch(() => {
    window.open(href, "_blank", "noreferrer");
  });
}

type Fact = { citation_number?: number; note_title: string | null; note_path: string | null; citation_anchor?: CitationAnchor };

type Citation = {
  number: number;
  title: string;
  path: string | null;
  anchor?: CitationAnchor;
};

export function citationToVaultNote(citation: Citation): VaultNote | null {
  if (!citation.path) return null;
  const segments = citation.path.split(/[\\/]/).filter(Boolean);
  return {
    title: citation.title,
    path: citation.path,
    folder: segments.slice(0, -1).join("/"),
    modifiedAt: "",
    anchor: citation.anchor,
  };
}

export function buildCitations(facts?: Fact[]): Citation[] {
  return (facts ?? []).flatMap((fact, index) => {
    if (!fact.note_path && !fact.note_title) return [];
    return [{
      number: fact.citation_number ?? index + 1,
      title: fact.note_title ?? fact.note_path ?? "",
      path: fact.note_path,
      anchor: fact.citation_anchor,
    }];
  });
}

type CaptureCommand = { url: string; instruction: string };
type CaptureSourceType = "web_page" | "youtube" | "audio_url" | "unknown_url";

export function parseCaptureCommand(value: string): CaptureCommand | null {
  const match = value.trim().match(/^\/capture(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const rest = (match[1] ?? "").trim();
  const [url = "", ...instruction] = rest.split(/\s+/);
  return { url, instruction: instruction.join(" ") };
}

export function detectModalCaptureSourceType(rawUrl: string): CaptureSourceType {
  try {
    const url = new URL(rawUrl.trim());
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (url.protocol !== "http:" && url.protocol !== "https:") return "unknown_url";
    if (
      host === "youtu.be" ||
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtube-nocookie.com" ||
      host.endsWith(".youtube-nocookie.com")
    ) {
      return "youtube";
    }
    if (/\.(mp3|m4a|wav|aac|flac|ogg|oga|opus|webm|mp4|m4v|mov)(?:$|[?#])/.test(path)) {
      return "audio_url";
    }
    return "web_page";
  } catch {
    return "unknown_url";
  }
}

export function expandToolSlashCommand(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^\/([a-z]+)(?:\s+([\s\S]*))?$/i);
  if (!match) return value;
  const command = match[1].toLowerCase();
  const input = (match[2] ?? "").trim();
  if (!input) return value;
  switch (command) {
    case "search":
      return `Search my vault notes for: ${input}`;
    case "read":
      return `Read the vault note matching this query and summarize it: ${input}`;
    case "open":
      return `Open the Obsidian note matching this query: ${input}`;
    case "note":
      return `Create a new vault note from this request: ${input}`;
    case "update":
      return `Update the relevant existing vault note from this request: ${input}`;
    case "conversation":
      return `Find and open previous conversations matching this query: ${input}`;
    default:
      return value;
  }
}

function renderInlineCitations(
  value: ReactNode,
  citationsByNumber: Map<number, Citation>,
  onOpenNote: (note: VaultNote) => void,
): ReactNode {
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value);
    const parts: ReactNode[] = [];
    const re = /\[(\d+)\]/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      if (match.index > last) {
        parts.push(text.slice(last, match.index));
      }
      const number = Number(match[1]);
      const citation = citationsByNumber.get(number);
      if (citation) {
        const note = citationToVaultNote(citation);
        const badge = (
          <span className="inline-flex size-4 items-center justify-center rounded-full border border-border bg-background text-[10px] font-medium leading-none text-foreground/80 align-[0.22em]">
            {number}
          </span>
        );
        parts.push(
          note ? (
            <button
              type="button"
              key={`${number}-${match.index}`}
              onClick={(e) => {
                e.preventDefault();
                onOpenNote(note);
              }}
              className="inline-flex cursor-pointer items-baseline"
            >
              {badge}
            </button>
          ) : (
            <span key={`${number}-${match.index}`} className="inline-flex items-baseline">
              {badge}
            </span>
          ),
        );
      } else {
        parts.push(match[0]);
      }
      last = match.index + match[0].length;
    }
    if (last < text.length) {
      parts.push(text.slice(last));
    }
    return parts.length ? <>{parts}</> : text;
  }
  if (Array.isArray(value)) {
    return value.map((child, idx) => (
      <span key={idx} className="contents">
        {renderInlineCitations(child, citationsByNumber, onOpenNote)}
      </span>
    ));
  }
  if (isValidElement(value)) {
    const children = (value.props as { children?: ReactNode }).children;
    return cloneElement(
      value as ReactElement<{ children?: ReactNode }>,
      { children: renderInlineCitations(children, citationsByNumber, onOpenNote) },
    );
  }
  return value;
}

export function createMarkdownComponents(
  citationsByNumber: Map<number, Citation>,
  onOpenNote: (note: VaultNote) => void,
) {
  return {
    p: ({ children }: { children?: ReactNode }) => (
      <p>{renderInlineCitations(children, citationsByNumber, onOpenNote)}</p>
    ),
    li: ({ children }: { children?: ReactNode }) => (
      <li>{renderInlineCitations(children, citationsByNumber, onOpenNote)}</li>
    ),
    blockquote: ({ children }: { children?: ReactNode }) => (
      <blockquote>{renderInlineCitations(children, citationsByNumber, onOpenNote)}</blockquote>
    ),
    strong: ({ children }: { children?: ReactNode }) => (
      <strong>{renderInlineCitations(children, citationsByNumber, onOpenNote)}</strong>
    ),
    em: ({ children }: { children?: ReactNode }) => (
      <em>{renderInlineCitations(children, citationsByNumber, onOpenNote)}</em>
    ),
    code: ({ children }: { children?: ReactNode }) => (
      <code>{renderInlineCitations(children, citationsByNumber, onOpenNote)}</code>
    ),
    a: ({ children, href }: { children?: ReactNode; href?: string }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          if (!href || !/^https?:\/\//i.test(href)) return;
          event.preventDefault();
          openExternalLink(href);
        }}
      >
        {renderInlineCitations(children, citationsByNumber, onOpenNote)}
      </a>
    ),
    span: ({ children }: { children?: ReactNode }) => (
      <span>{renderInlineCitations(children, citationsByNumber, onOpenNote)}</span>
    ),
    h1: ({ children }: { children?: ReactNode }) => (
      <h1>{renderInlineCitations(children, citationsByNumber, onOpenNote)}</h1>
    ),
    h2: ({ children }: { children?: ReactNode }) => (
      <h2>{renderInlineCitations(children, citationsByNumber, onOpenNote)}</h2>
    ),
    h3: ({ children }: { children?: ReactNode }) => (
      <h3>{renderInlineCitations(children, citationsByNumber, onOpenNote)}</h3>
    ),
    h4: ({ children }: { children?: ReactNode }) => (
      <h4>{renderInlineCitations(children, citationsByNumber, onOpenNote)}</h4>
    ),
    h5: ({ children }: { children?: ReactNode }) => (
      <h5>{renderInlineCitations(children, citationsByNumber, onOpenNote)}</h5>
    ),
    h6: ({ children }: { children?: ReactNode }) => (
      <h6>{renderInlineCitations(children, citationsByNumber, onOpenNote)}</h6>
    ),
  } as const;
}
