import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import cliSpinners from "cli-spinners";

const thinkingSpinners = [
  cliSpinners.star,
  cliSpinners.star2,
  cliSpinners.dots,
  cliSpinners.dots2,
  cliSpinners.dots8,
  cliSpinners.arc,
  cliSpinners.circle,
  cliSpinners.bounce,
];

function elapsedSecondsSince(since: string): number {
  const start = new Date(since).getTime();
  return Number.isNaN(start) ? 0 : Math.max(0, Math.floor((Date.now() - start) / 1000));
}

function elapsedTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function ThinkingLoader() {
  const reduceMotion = useReducedMotion();
  const [spinner] = useState(
    () => thinkingSpinners[Math.floor(Math.random() * thinkingSpinners.length)],
  );
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (reduceMotion) return;
    const interval = window.setInterval(
      () => setFrameIndex((current) => (current + 1) % spinner.frames.length),
      spinner.interval,
    );
    return () => window.clearInterval(interval);
  }, [reduceMotion, spinner]);

  return (
    <span
      className="inline-flex size-4 shrink-0 items-center justify-center font-mono text-[15px] leading-none text-primary"
      aria-hidden="true"
    >
      {spinner.frames[frameIndex]}
    </span>
  );
}

export function ThinkingIndicator(props: { since: string; label: string }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(() => elapsedSecondsSince(props.since));

  useEffect(() => {
    setElapsedSeconds(elapsedSecondsSince(props.since));
    const interval = window.setInterval(
      () => setElapsedSeconds(elapsedSecondsSince(props.since)),
      1000,
    );
    return () => window.clearInterval(interval);
  }, [props.since]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -2 }}
      transition={{ duration: 0.18 }}
      role="status"
      aria-live="polite"
      aria-label={props.label}
      className="flex min-h-7 items-center gap-2 text-[13px]"
    >
      <ThinkingLoader />
      <span className="font-medium text-foreground/75">{props.label}</span>
      {elapsedSeconds >= 5 && (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="tabular-nums text-[11px] text-muted-foreground/55"
        >
          {elapsedTime(elapsedSeconds)}
        </motion.span>
      )}
    </motion.div>
  );
}
