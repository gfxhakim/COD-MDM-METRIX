"use client";

import type { Role } from "@prisma/client";
import { Check, ChevronDown, ClipboardList, LayoutDashboard, LogOut, Megaphone, Menu, Plus, RefreshCw, Settings, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { logoutAction, switchWorkspaceAction } from "@/app/(auth)/actions";
import { Logo } from "@/components/app/logo";
import { isActive, NAV } from "@/components/app/nav";
import { CurrencyPicker, CurrencyProvider } from "@/components/app/currency";
import { DataFreshness } from "@/components/app/data-freshness";
import { Badge } from "@/components/ui/badge";
import { useSlidingPill } from "@/components/ui/sliding-pill";
import { cn } from "@/lib/utils";

export type ShellWorkspace = { id: string; name: string; isDemo: boolean; role: Role };
type ShellUser = { name: string; email: string };

const ShellCtx = React.createContext<{ user: ShellUser; workspace: ShellWorkspace } | null>(null);

/** The signed-in person and the workspace being viewed. */
export function useShell() {
  const v = React.useContext(ShellCtx);
  if (!v) throw new Error("useShell must be used inside AppShell");
  return v;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Open state for a small menu that closes on an outside click or Escape. */
function usePopover() {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const pill = "slide-item press flex h-9 items-center whitespace-nowrap rounded-full px-4 text-sm font-medium";
const pillActive = "bg-brand glow";
const pillIdle = "text-muted hover:bg-surface-3 hover:text-fg";
const menuPop = "animate-pop absolute right-0 top-full z-50 mt-2 rounded-2xl border border-border bg-surface shadow-xl";

/** Computer menu: a row of pills with the less used pages under "More". */
function TopNav() {
  const pathname = usePathname();
  const { open: moreOpen, setOpen: setMoreOpen, ref: moreRef } = usePopover();
  const { boxRef, pill: slider } = useSlidingPill<HTMLElement>();
  const inMore = NAV.filter((n) => n.tier > 1);
  // A page under "More" lights up the More button. Pages with their own pill from 2xl up only do so below 2xl.
  const moreTier = inMore.find((n) => isActive(n.href, pathname))?.tier;
  return (
    <nav ref={boxRef} data-slide="" aria-label="Main" className="relative hidden items-center gap-0.5 rounded-full bg-surface p-1 shadow-card lg:flex">
      {slider}
      {NAV.filter((n) => n.tier < 3).map(({ href, short, tier }) => {
        const active = isActive(href, pathname);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn(pill, active ? pillActive : pillIdle, tier === 2 && "hidden 2xl:flex")}>
            {short}
          </Link>
        );
      })}
      <div ref={moreRef} className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          data-active={moreTier ? "true" : undefined}
          onClick={() => setMoreOpen((o) => !o)}
          className={cn(pill, "gap-1", moreTier === 3 ? pillActive : moreTier === 2 ? cn(pillIdle, "max-2xl:bg-brand max-2xl:glow max-2xl:text-white") : pillIdle)}
        >
          More <ChevronDown className={cn("size-3.5 transition-transform duration-300", moreOpen && "rotate-180")} />
        </button>
        {moreOpen ? (
          <div role="menu" className={cn(menuPop, "w-56 p-1.5")}>
            {inMore.map(({ href, label, icon: Icon, tier }) => {
              const active = isActive(href, pathname);
              return (
                <Link key={href} role="menuitem" href={href} onClick={() => setMoreOpen(false)} aria-current={active ? "page" : undefined} className={cn("flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors", active ? "bg-brand-soft font-semibold text-brand-strong" : "text-fg hover:bg-surface-2", tier === 2 && "2xl:hidden")}>
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                </Link>
              );
            })}
          </div>
        ) : null}
      </div>
    </nav>
  );
}

/** Phone and tablet menu: every page as a pill in one row that scrolls sideways. */
function PillRow() {
  const pathname = usePathname();
  const rowRef = React.useRef<HTMLDivElement>(null);
  const { boxRef, pill: slider } = useSlidingPill<HTMLDivElement>();
  React.useEffect(() => {
    const row = rowRef.current;
    const el = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (row && el) row.scrollTo({ left: el.offsetLeft - 16, behavior: "smooth" });
  }, [pathname]);
  return (
    <nav aria-label="Pages" className="-mx-4 lg:hidden">
      <div ref={rowRef} className="no-scrollbar flex gap-1 overflow-x-auto px-4">
        <div ref={boxRef} data-slide="" className="relative flex gap-0.5 rounded-full bg-surface p-1 shadow-card">
          {slider}
          {NAV.map(({ href, short }) => {
            const active = isActive(href, pathname);
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn(pill, "h-8 px-3.5", active ? pillActive : pillIdle)}>
                {short}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

function WorkspaceList({ current, workspaces, onDone }: { current: ShellWorkspace; workspaces: ShellWorkspace[]; onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <div role="listbox" aria-label="Workspaces" className="flex flex-col gap-0.5">
      {workspaces.map((w) => (
        <button
          key={w.id}
          type="button"
          role="option"
          aria-selected={w.id === current.id}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await switchWorkspaceAction(w.id);
              if (res && "ok" in res) {
                onDone();
                router.refresh();
              }
            })
          }
          className={cn("flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2", w.id === current.id && "font-semibold text-brand-strong")}
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-3 text-[11px] font-bold text-fg">{initials(w.name)}</span>
          <span className="min-w-0 flex-1 truncate">{w.name}</span>
          {w.isDemo ? <Badge tone="warning">demo</Badge> : null}
          {w.id === current.id ? <Check className="size-4" aria-hidden="true" /> : null}
        </button>
      ))}
    </div>
  );
}

/** Avatar button: switch workspace, settings, sign out. */
function AccountMenu({ current, workspaces, user }: { current: ShellWorkspace; workspaces: ShellWorkspace[]; user: ShellUser }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account and workspace: ${current.name}`}
        onClick={() => setOpen((o) => !o)}
        className="press flex items-center gap-2.5 rounded-full bg-surface p-1 shadow-card hover:shadow-md min-[1400px]:pr-3"
      >
        <span className="bg-brand-hero grid size-9 shrink-0 place-items-center rounded-full text-sm font-extrabold">{initials(user.name)}</span>
        <span className="hidden min-w-0 flex-col text-left leading-tight min-[1400px]:flex">
          <span className="max-w-36 truncate text-sm font-bold">{user.name}</span>
          <span className="max-w-36 truncate text-[11px] text-muted">{current.name}</span>
        </span>
        <ChevronDown className={cn("hidden size-4 text-muted transition-transform duration-300 min-[1400px]:block", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open ? (
        <div role="menu" className={cn(menuPop, "w-72 p-2")}>
          <div className="px-3 py-2">
            <p className="truncate text-sm font-bold">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">Workspaces</p>
          <WorkspaceList current={current} workspaces={workspaces} onDone={() => setOpen(false)} />
          <div className="mt-1 flex flex-col gap-0.5 border-t border-border pt-1">
            <Link role="menuitem" href="/settings?tab=new-workspace" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-surface-2"><Plus className="size-4" /> New workspace</Link>
            <Link role="menuitem" href="/settings" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-surface-2"><Settings className="size-4" /> Settings</Link>
            <form action={logoutAction}>
              <button role="menuitem" type="submit" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-negative hover:bg-negative-soft"><LogOut className="size-4" /> Sign out</button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Phone drawer: every page, the workspaces and sign out. */
function Drawer({ current, workspaces, user, onClose: close }: { current: ShellWorkspace; workspaces: ShellWorkspace[]; user: ShellUser; onClose: () => void }) {
  const pathname = usePathname();
  // Closing slides the panel out first, then removes it.
  const [closing, setClosing] = React.useState(false);
  const onClose = React.useCallback(() => {
    setClosing(true);
    window.setTimeout(close, 200);
  }, [close]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
      <div className={cn("absolute inset-0 bg-ink/40 backdrop-blur-[2px]", closing ? "animate-[fade-out_200ms_ease-in_both]" : "animate-fade")} onClick={onClose} />
      <aside className={cn("absolute inset-y-0 right-0 flex w-[min(20rem,88vw)] flex-col gap-4 overflow-y-auto rounded-l-[28px] bg-surface p-4 shadow-2xl", closing ? "animate-[slide-out-right_200ms_ease-in_both]" : "animate-[slide-in-right_420ms_var(--ease-out)_backwards]")}>
        <div className="flex items-center justify-between">
          <Logo />
          <button type="button" className="press grid size-10 place-items-center rounded-full bg-surface-3 text-fg hover:rotate-90" onClick={onClose} aria-label="Close navigation"><X className="size-5" /></button>
        </div>
        <nav aria-label="Main" className="stagger flex flex-col gap-0.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(href, pathname);
            return (
              <Link key={href} href={href} onClick={onClose} aria-current={active ? "page" : undefined} className={cn("press flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium", active ? "bg-brand glow" : "text-fg hover:bg-surface-2")}>
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border pt-3">
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-subtle">Workspaces</p>
          <WorkspaceList current={current} workspaces={workspaces} onDone={onClose} />
          <Link href="/settings?tab=new-workspace" onClick={onClose} className="mt-0.5 flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-surface-2"><Plus className="size-4" /> New workspace</Link>
        </div>
        <div className="mt-auto flex items-center gap-2 border-t border-border pt-3">
          <div className="min-w-0 flex-1 px-1">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            <p className="truncate text-[11px] text-muted">{user.email}</p>
          </div>
          <form action={logoutAction}>
            <button type="submit" aria-label="Sign out" className="press grid size-10 place-items-center rounded-full bg-negative-soft text-negative"><LogOut className="size-4" /></button>
          </form>
        </div>
      </aside>
    </div>
  );
}

/** Phone shortcut bar at the bottom of the screen. */
function BottomBar({ onMenu }: { onMenu: () => void }) {
  const pathname = usePathname();
  const item = (href: string, label: string, Icon: typeof LayoutDashboard) => {
    const active = isActive(href, pathname);
    return (
      <Link href={href} aria-label={label} aria-current={active ? "page" : undefined} className={cn("press relative grid size-11 place-items-center rounded-full", active ? "text-brand-strong" : "text-muted")}>
        <Icon className={cn("size-5 transition-transform duration-300", active && "-translate-y-1")} aria-hidden="true" />
        {active ? <span className="bg-brand glow-soft animate-pop absolute bottom-1 size-1.5 rounded-full" aria-hidden="true" /> : null}
      </Link>
    );
  };
  return (
    <nav aria-label="Shortcuts" style={{ viewTransitionName: "bottom-bar" }} className="fixed inset-x-3 bottom-3 z-40 flex h-16 items-center justify-around rounded-full bg-surface/95 px-2 shadow-[0_12px_30px_rgb(20_16_18/0.16)] backdrop-blur md:hidden">
      {item("/", "Dashboard", LayoutDashboard)}
      {item("/orders", "Orders & parcels", ClipboardList)}
      <Link href="/syncs" aria-label="MDM sync" className="bg-brand-hero neon press grid size-14 -translate-y-1 place-items-center rounded-full">
        <RefreshCw className="size-5" aria-hidden="true" />
      </Link>
      {item("/creatives", "Creatives", Megaphone)}
      <button type="button" onClick={onMenu} aria-label="All pages" className="press grid size-11 place-items-center rounded-full text-muted"><Menu className="size-5" aria-hidden="true" /></button>
    </nav>
  );
}

export function AppShell({ current, workspaces, user, children }: { current: ShellWorkspace; workspaces: ShellWorkspace[]; user: ShellUser; children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const closeMobile = React.useCallback(() => setMobileOpen(false), []);
  const shell = React.useMemo(() => ({ user, workspace: current }), [user, current]);
  return (
    <CurrencyProvider workspaceId={current.id}>
    <ShellCtx.Provider value={shell}>
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[70] focus:rounded-full focus:bg-brand focus:px-4 focus:py-2">Skip to content</a>
      {current.isDemo ? (
        <div className="border-b border-warning/20 bg-warning-soft px-4 py-1.5 text-center text-xs font-medium text-warning" role="note">
          DEMO DATA · Synthetic workspace. Nothing here is a real business or real MDM data.
        </div>
      ) : null}
      <header style={{ viewTransitionName: "site-header" }} className="z-30 bg-bg/80 backdrop-blur-md md:sticky md:top-0">
        <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3 lg:px-8">
          <Link href="/" aria-label="COD Flow dashboard" className="press mr-1 shrink-0 rounded-full"><Logo /></Link>
          <TopNav />
          {/* One copy for every screen size: its own row on phones, beside the account button from md up. */}
          <div className="no-scrollbar order-last -my-1 flex w-full items-center gap-2 overflow-x-auto py-1 md:order-none md:ml-auto md:w-auto md:overflow-visible"><CurrencyPicker /><DataFreshness /></div>
          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <AccountMenu current={current} workspaces={workspaces} user={user} />
            <button type="button" className="press grid size-11 place-items-center rounded-full bg-surface text-fg shadow-card lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu className="size-5" /></button>
          </div>
        </div>
      </header>
      <div className="mx-auto w-full max-w-[1600px] px-4 pt-1 lg:hidden">
        <PillRow />
      </div>
      {mobileOpen ? <Drawer current={current} workspaces={workspaces} user={user} onClose={closeMobile} /> : null}
      <main id="main" className="mx-auto w-full max-w-[1600px] flex-1 px-4 pb-28 pt-5 md:pb-10 lg:px-8">{children}</main>
      <BottomBar onMenu={() => setMobileOpen(true)} />
    </div>
    </ShellCtx.Provider>
    </CurrencyProvider>
  );
}
