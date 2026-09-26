export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#b6f24a" />
        <path d="M8 21.5 13 15l4 3.5 7-9" fill="none" stroke="#0a0c0f" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="24" cy="9.5" r="2" fill="#0a0c0f" />
      </svg>
      {compact ? null : (
        <span className="text-sm font-semibold tracking-tight text-fg">
          COD Flow <span className="text-muted">Tracker</span>
        </span>
      )}
    </span>
  );
}
