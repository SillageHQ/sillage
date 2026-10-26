import { useEffect, useState } from "react";
import { useLingui as useLinguiReact } from "@lingui/react";
import { t } from "@lingui/core/macro";
import { MessageCircle, X } from "lucide-react";
import { motion } from "motion/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { API_URL as API } from "@/lib/api";
import { NotePreview, type VaultNote } from "@/components/vault-explorer";
import { Button } from "@/components/ui/button";

function messageTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return new Intl.DateTimeFormat(locale, sameDay ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function fullMessageTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function PreviewTimestamp(props: { iso?: string; role: "user" | "brain"; locale: string }) {
  if (!props.iso) return null;
  const label = messageTime(props.iso, props.locale);
  if (!label) return null;
  return <div title={fullMessageTime(props.iso, props.locale)} className={cn("mt-2 text-[11px] leading-none tabular-nums", props.role === "user" ? "text-primary-foreground/65" : "text-muted-foreground")}>{label}</div>;
}
export function NotePreviewModal(props: {
  vaultPath: string;
  note: VaultNote;
  onClose: () => void;
  onChat: (note: VaultNote) => void;
  onOpenObsidian: (note: VaultNote) => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.onClose]);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={props.note.title}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}
    >
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.99 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="flex h-[min(86vh,860px)] w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
      >
        <NotePreview
          vaultPath={props.vaultPath}
          note={props.note}
          onClose={props.onClose}
          onChat={props.onChat}
          onOpenObsidian={props.onOpenObsidian}
        />
      </motion.div>
    </motion.div>
  );
}

export type ConversationPreview = {
  id: string;
  title: string;
  messages: Array<{
    role: "user" | "brain";
    text: string;
    createdAt?: string;
  }>;
};

export function ConversationPreviewModal(props: {
  conversationId: string;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const { i18n } = useLinguiReact();
  const [conversation, setConversation] = useState<ConversationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch(`${API}/conversations/${props.conversationId}`)
      .then((response) => {
        if (!response.ok) throw new Error("Conversation unavailable");
        return response.json();
      })
      .then((data) => {
        if (!cancelled) setConversation(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.conversationId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.onClose]);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={conversation?.title || "Conversation preview"}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}
    >
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.99 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="flex h-[min(82vh,760px)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
            <MessageCircle className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Conversation source</div>
            <h2 className="truncate text-[14px] font-medium">{conversation?.title || "Conversation"}</h2>
          </div>
          {conversation && (
            <Button variant="outline" size="sm" onClick={() => props.onOpen(conversation.id)}>
              <MessageCircle className="size-3.5" /> Open conversation
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={props.onClose} title={t`Close`} aria-label={t`Close`}>
            <X className="size-4" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loading && <div className="py-12 text-center text-[13px] text-muted-foreground">Loading conversation...</div>}
          {error && <div className="py-12 text-center text-[13px] text-muted-foreground">Conversation unavailable.</div>}
          {!loading && !error && conversation && (
            <div className="mx-auto flex max-w-2xl flex-col gap-3">
              {conversation.messages.map((message, index) => (
                <div
                  key={index}
                  className={cn(
                    "max-w-[88%] rounded-2xl px-3.5 py-3 text-[14px] leading-relaxed",
                    message.role === "user"
                      ? "self-end bg-primary text-primary-foreground whitespace-pre-wrap"
                      : "md self-start border border-border bg-secondary",
                  )}
                >
                  {message.role === "brain" ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
                  ) : message.text}
                  <PreviewTimestamp iso={message.createdAt} role={message.role} locale={i18n.locale || "en"} />
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
