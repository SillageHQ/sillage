import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

export type SourcePoint = {
  offset: number | null;
  line: number | null;
  column: number | null;
};

export type CitationAnchor = {
  quote: string;
  start: SourcePoint;
  end: SourcePoint;
  chunk_id?: string | null;
  content_hash?: string | null;
};

type PositionedNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: PositionedNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
};

const noteSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "u", "mark", "details", "summary"],
  attributes: {
    ...defaultSchema.attributes,
    mark: ["className", "dataCitationHighlight"],
    input: [...(defaultSchema.attributes?.input ?? []), "checked", "disabled", "type"],
  },
};

function rehypeHighlight(range?: { start: number; end: number }) {
  return () => (tree: PositionedNode) => {
    if (!range || range.end <= range.start) return;

    const visit = (parent: PositionedNode) => {
      if (!parent.children) return;
      const children: PositionedNode[] = [];
      for (const node of parent.children) {
        const start = node.position?.start?.offset;
        const end = node.position?.end?.offset;
        if (node.type === "text" && typeof node.value === "string" && start !== undefined && end !== undefined) {
          const overlapStart = Math.max(range.start, start);
          const overlapEnd = Math.min(range.end, end);
          if (overlapStart < overlapEnd) {
            const localStart = Math.max(0, overlapStart - start);
            const localEnd = Math.min(node.value.length, overlapEnd - start);
            if (localStart > 0) children.push({ ...node, value: node.value.slice(0, localStart), position: undefined });
            children.push({
              type: "element",
              tagName: "mark",
              properties: { className: ["citation-highlight"], dataCitationHighlight: "true" },
              children: [{ type: "text", value: node.value.slice(localStart, localEnd) }],
            });
            if (localEnd < node.value.length) children.push({ ...node, value: node.value.slice(localEnd), position: undefined });
            continue;
          }
        }
        visit(node);
        children.push(node);
      }
      parent.children = children;
    };

    visit(tree);
  };
}

function prepareObsidianMarkdown(markdown: string, highlight?: { start: number; end: number }) {
  const pattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  const parts: string[] = [];
  const changes: Array<{ originalStart: number; originalEnd: number; renderedStart: number; renderedEnd: number }> = [];
  let originalCursor = 0;
  let renderedLength = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown))) {
    const before = markdown.slice(originalCursor, match.index);
    parts.push(before);
    renderedLength += before.length;
    const target = match[1];
    const label = match[2] || target;
    const replacement = `[${label}](wikilink:${encodeURIComponent(target)})`;
    parts.push(replacement);
    changes.push({
      originalStart: match.index,
      originalEnd: match.index + match[0].length,
      renderedStart: renderedLength,
      renderedEnd: renderedLength + replacement.length,
    });
    renderedLength += replacement.length;
    originalCursor = match.index + match[0].length;
  }
  parts.push(markdown.slice(originalCursor));

  const mapOffset = (offset: number) => {
    let delta = 0;
    for (const change of changes) {
      if (offset <= change.originalStart) break;
      if (offset < change.originalEnd) {
        const progress = (offset - change.originalStart) / (change.originalEnd - change.originalStart);
        return Math.round(change.renderedStart + progress * (change.renderedEnd - change.renderedStart));
      }
      delta += (change.renderedEnd - change.renderedStart) - (change.originalEnd - change.originalStart);
    }
    return offset + delta;
  };

  return {
    markdown: parts.join(""),
    highlight: highlight ? { start: mapOffset(highlight.start), end: mapOffset(highlight.end) } : undefined,
  };
}

export function ObsidianMarkdown(props: {
  children: string;
  className?: string;
  highlight?: { start: number; end: number };
  compact?: boolean;
}) {
  const prepared = prepareObsidianMarkdown(props.children, props.highlight);
  const components = {
    a: ({ href, children, ...anchorProps }: ComponentPropsWithoutRef<"a">) => {
      const wiki = href?.startsWith("wikilink:");
      return (
        <a
          {...anchorProps}
          href={wiki ? undefined : href}
          className={cn(wiki && "obsidian-wikilink")}
          data-wikilink={wiki && href ? decodeURIComponent(href.slice("wikilink:".length)) : undefined}
        >
          {children}
        </a>
      );
    },
  };

  return (
    <div className={cn("md note-markdown", props.compact && "note-markdown-compact", props.className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, noteSchema],
          rehypeHighlight(prepared.highlight),
        ]}
        urlTransform={(url) => url.startsWith("wikilink:") ? url : defaultUrlTransform(url)}
        components={components}
      >
        {prepared.markdown}
      </ReactMarkdown>
    </div>
  );
}
