import { useEffect, useRef, useState } from "react";
import { t } from "@lingui/core/macro";
import { motion } from "motion/react";
import { Archive, MessageCircle, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { API_URL } from "@/lib/api";

type ConversationResult = {
  id: string;
  title: string;
  snippet: string;
  updatedAt: string;
  archivedAt: string | null;
};

export function ChatSearchModal(props: { onClose: () => void; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ConversationResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, Math.max(0, results.length - 1)));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => Math.max(0, index - 1));
      }
      if (event.key === "Enter" && results[activeIndex]) props.onOpen(results[activeIndex].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, props, results]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`${API_URL}/conversations/search?q=${encodeURIComponent(query)}&limit=5`);
        const data = await response.json();
        if (!cancelled) {
          setResults(Array.isArray(data.conversations) ? data.conversations : []);
          setActiveIndex(0);
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/55 px-6 pt-[14vh] backdrop-blur-sm"
      onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.98, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.99, y: -4 }}
        className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="size-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t`Search conversations...`}
            className="h-12 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
          />
          <button onClick={props.onClose} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[420px] min-h-24 overflow-y-auto p-1.5">
          {!query.trim() && <div className="px-3 py-8 text-center text-[12px] text-muted-foreground">{t`Search chat titles and messages`}</div>}
          {query.trim() && loading && <div className="px-3 py-8 text-center text-[12px] text-muted-foreground">{t`Searching...`}</div>}
          {query.trim() && !loading && results.length === 0 && <div className="px-3 py-8 text-center text-[12px] text-muted-foreground">{t`No conversations found`}</div>}
          {results.map((result, index) => (
            <button
              key={result.id}
              type="button"
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => props.onOpen(result.id)}
              className={cn("flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left", activeIndex === index && "bg-accent")}
            >
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
                {result.archivedAt ? <Archive className="size-3.5" /> : <MessageCircle className="size-3.5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{result.title}</span>
                {result.snippet && <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{result.snippet}</span>}
              </span>
              {result.archivedAt && <span className="mt-1 text-[10px] text-muted-foreground">{t`Archived`}</span>}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
          <span>↑↓ {t`Navigate`}</span><span>↵ {t`Open`}</span><span>esc {t`Close`}</span>
        </div>
      </motion.div>
    </motion.div>
  );
}
