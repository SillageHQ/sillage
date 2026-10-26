import { useMemo, useState } from "react";
import { t } from "@lingui/core/macro";
import { motion } from "motion/react";
import { FilePlus2, FilePenLine, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type NoteChange = {
  id?: string;
  kind: "created" | "modified" | "deleted";
  noteTitle: string;
  notePath: string;
  beforeContent: string;
  afterContent: string;
  addedLines: number;
  removedLines: number;
};

type DiffRow = { before: string | null; after: string | null; changed: boolean };

function diffRows(before: string, after: string): DiffRow[] {
  const left = before.split("\n");
  const right = after.split("\n");
  const rows: DiffRow[] = [];
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const beforeLine = left[index] ?? null;
    const afterLine = right[index] ?? null;
    rows.push({ before: beforeLine, after: afterLine, changed: beforeLine !== afterLine });
  }
  return rows;
}

function ChangeIcon({ kind }: { kind: NoteChange["kind"] }) {
  const Glyph = kind === "created" ? FilePlus2 : kind === "deleted" ? Trash2 : FilePenLine;
  return <Glyph className="size-3.5" strokeWidth={1.8} />;
}

export function ChangeDiffModal(props: { changes: NoteChange[]; onClose: () => void }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = props.changes[selectedIndex] ?? props.changes[0];
  const rows = useMemo(
    () => diffRows(selected?.beforeContent ?? "", selected?.afterContent ?? ""),
    [selected],
  );

  if (!selected) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-8 backdrop-blur-sm"
      onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.98, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.99, y: 4 }}
        className="flex h-[78vh] w-full max-w-6xl overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
      >
        <aside className="w-56 shrink-0 overflow-y-auto border-r border-border bg-sidebar p-2">
          <div className="px-2 pb-2 pt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t`Changes`}
          </div>
          {props.changes.map((change, index) => (
            <button
              key={`${change.notePath}-${index}`}
              onClick={() => setSelectedIndex(index)}
              className={cn(
                "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-[12px]",
                index === selectedIndex ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60",
              )}
            >
              <span className={cn("mt-0.5", change.kind === "deleted" ? "text-destructive" : "text-emerald-500")}>
                <ChangeIcon kind={change.kind} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-foreground/90">{change.noteTitle}</span>
                <span className="block truncate text-[10px]">{change.notePath}</span>
              </span>
            </button>
          ))}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
            <div className="min-w-0">
              <span className="text-[13px] font-medium">{selected.noteTitle}</span>
              <span className="ml-2 text-[11px] text-muted-foreground">{selected.notePath}</span>
            </div>
            <button onClick={props.onClose} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="size-4" />
            </button>
          </header>
          <div className="grid shrink-0 grid-cols-2 border-b border-border bg-card text-[11px] text-muted-foreground">
            <div className="border-r border-border px-4 py-2">{t`Before`}</div>
            <div className="px-4 py-2">{t`After`}</div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-card/30 font-mono text-[11px] leading-5">
            {rows.map((row, index) => (
              <div key={index} className="grid min-w-[900px] grid-cols-2">
                <div className={cn("flex border-r border-border/70", row.changed && row.before !== null && "bg-destructive/10")}>
                  <span className="w-10 shrink-0 select-none pr-3 text-right text-muted-foreground/45">{row.before === null ? "" : index + 1}</span>
                  <span className="whitespace-pre-wrap break-all px-2">{row.before ?? ""}</span>
                </div>
                <div className={cn("flex", row.changed && row.after !== null && "bg-emerald-500/10")}>
                  <span className="w-10 shrink-0 select-none pr-3 text-right text-muted-foreground/45">{row.after === null ? "" : index + 1}</span>
                  <span className="whitespace-pre-wrap break-all px-2">{row.after ?? ""}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </motion.div>
    </motion.div>
  );
}
