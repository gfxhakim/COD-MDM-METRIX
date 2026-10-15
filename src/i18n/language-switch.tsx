"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { cn } from "@/lib/utils";
import { setLocaleAction } from "./actions";
import { useT } from "./client";
import { dirOf, type Locale } from "./core";

const OPTIONS: { locale: Locale; label: string; name: string }[] = [
  { locale: "en", label: "EN", name: "English" },
  { locale: "ar", label: "ع", name: "العربية" },
];

/** English or Arabic, at the top of every page. The page turns right to left for Arabic. */
export function LanguageSwitch({ className }: { className?: string }) {
  const { locale, t } = useT();
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const pick = (next: Locale) => {
    if (next === locale || pending) return;
    // Turn the page at once; the server sends the texts in the new language right after.
    document.documentElement.setAttribute("lang", next);
    document.documentElement.setAttribute("dir", dirOf(next));
    start(async () => {
      await setLocaleAction(next);
      router.refresh();
    });
  };
  return (
    <div role="group" aria-label={t("Language")} className={cn("flex h-10 shrink-0 items-center gap-0.5 rounded-full bg-surface p-1 shadow-card", pending && "opacity-70", className)}>
      {OPTIONS.map((o) => (
        <button
          key={o.locale}
          type="button"
          lang={o.locale}
          aria-pressed={locale === o.locale}
          aria-label={o.name}
          title={o.name}
          onClick={() => pick(o.locale)}
          className={cn(
            "press grid h-8 min-w-9 place-items-center rounded-full px-2.5 text-[13px] font-bold transition-colors",
            locale === o.locale ? "bg-brand text-white glow-soft" : "text-muted hover:bg-brand-soft hover:text-brand-strong",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
