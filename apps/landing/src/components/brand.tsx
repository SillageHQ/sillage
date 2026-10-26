export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg className={`mark ${className}`} viewBox="0 0 44 44" aria-hidden="true">
      <path className="mark-primary" d="M5 10c0-2 1-3 3-4L21 1v14c0 4-2 6-6 8-4 2-5 4-1 7 5 3 7 5 7 10v3H8c-2 0-3-1-3-3V10Z" />
      <path className="mark-accent" d="M26 12c0-2 1-3 3-3h10v31c0 2-1 3-3 3H26v-8c0-4-2-6-6-8-3-2-3-3 1-5 3-2 5-4 5-7v-3Z" />
    </svg>
  );
}

export function Wordmark() {
  return <span className="wordmark"><BrandMark /><b>Sillage</b></span>;
}
