export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="bg-brand-hero grid size-10 shrink-0 place-items-center rounded-full shadow-[0_6px_18px_rgb(225_24_44/0.45),inset_0_1px_0_rgb(255_255_255/0.4)]">
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true" fill="none" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 17 17 7" />
          <path d="M8 7h9v9" />
        </svg>
      </span>
      {compact ? null : <span className="text-lg font-extrabold tracking-tight whitespace-nowrap text-fg">COD Flow</span>}
    </span>
  );
}
