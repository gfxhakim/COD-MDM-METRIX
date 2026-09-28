"use client";

import type { Role } from "@prisma/client";
import { ChevronsUpDown, LogOut, Menu, Plus, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { logoutAction, switchWorkspaceAction } from "@/app/(auth)/actions";
import { Logo } from "@/components/app/logo";
import { NAV } from "@/components/app/nav";
import { CurrencyPicker, CurrencyProvider } from "@/components/app/currency";
import { DataFreshness } from "@/components/app/data-freshness";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ShellWorkspace = { id: string; name: string; isDemo: boolean; role: Role };

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface/80 hover:text-fg",
            )}
          >
            <Icon className={cn("size-4", active ? "text-positive" : "")} aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function WorkspaceSwitcher({ current, workspaces }: { current: ShellWorkspace; workspaces: ShellWorkspace[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm hover:border-border-strong"
      >
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-surface-3 text-[11px] font-semibold">{current.name.slice(0, 2).toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{current.name}</span>
          <span className="block text-[11px] text-subtle">{current.role.toLowerCase()}</span>
        </span>
        <ChevronsUpDown className="size-4 text-subtle" />
      </button>
      {open ? (
        <div role="listbox" aria-label="Workspaces" className="absolute inset-x-0 top-full z-50 mt-1 rounded-lg border border-border-strong bg-surface-2 p-1 shadow-xl">
          {workspaces.map((w) => (
            <button
              key={w.id}
              role="option"
              aria-selected={w.id === current.id}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await switchWorkspaceAction(w.id);
                  if (res && "ok" in res) {
                    setOpen(false);
                    router.refresh();
                  }
                })
              }
              className={cn("flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-3", w.id === current.id && "text-positive")}
            >
              <span className="truncate">{w.name}</span>
              {w.isDemo ? <Badge tone="warning">demo</Badge> : null}
            </button>
          ))}
          <Link href="/settings?tab=new-workspace" onClick={() => setOpen(false)} className="mt-1 flex items-center gap-2 rounded-md border-t border-border px-2 py-1.5 text-sm text-muted hover:bg-surface-3 hover:text-fg">
            <Plus className="size-4" /> New workspace
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function SidebarContent({ current, workspaces, user, onNavigate }: { current: ShellWorkspace; workspaces: ShellWorkspace[]; user: { name: string; email: string }; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-5 p-4">
      <div className="px-1 pt-1"><Logo /></div>
      <WorkspaceSwitcher current={current} workspaces={workspaces} />
      <NavLinks onNavigate={onNavigate} />
      <div className="mt-auto flex items-center gap-2 border-t border-border pt-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{user.name}</p>
          <p className="truncate text-[11px] text-subtle">{user.email}</p>
        </div>
        <form action={logoutAction}>
          <Button variant="ghost" size="icon" type="submit" aria-label="Sign out"><LogOut /></Button>
        </form>
      </div>
    </div>
  );
}

export function AppShell({ current, workspaces, user, children }: { current: ShellWorkspace; workspaces: ShellWorkspace[]; user: { name: string; email: string }; children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  return (
    <CurrencyProvider workspaceId={current.id}>
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[70] focus:rounded-md focus:bg-positive focus:px-3 focus:py-2 focus:text-black">Skip to content</a>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-border bg-sidebar lg:block">
        <SidebarContent current={current} workspaces={workspaces} user={user} />
      </aside>
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-border bg-sidebar">
            <button className="absolute right-3 top-4 rounded-md p-1 text-muted hover:text-fg" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X className="size-5" /></button>
            <SidebarContent current={current} workspaces={workspaces} user={user} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        {current.isDemo ? (
          <div className="border-b border-warning/30 bg-warning-soft px-4 py-1.5 text-center text-xs font-medium text-warning" role="note">
            DEMO DATA · Synthetic workspace. Nothing here is a real business or real MDM data.
          </div>
        ) : null}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur lg:px-8">
          <button className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu className="size-5" /></button>
          <div className="lg:hidden"><Logo compact /></div>
          <div className="ml-auto flex items-center gap-3"><CurrencyPicker /><DataFreshness /></div>
        </header>
        <main id="main" className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
    </CurrencyProvider>
  );
}
