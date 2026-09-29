import { Calculator, ClipboardList, FileUp, LayoutDashboard, Megaphone, Package, RefreshCw, Receipt, Settings, Target } from "lucide-react";

/**
 * `tier` decides where a page sits in the top menu on a computer: 1 always shows as a pill,
 * 2 shows as a pill on wide screens and under "More" otherwise, 3 is always under "More".
 */
export const NAV = [
  { href: "/", label: "Dashboard", short: "Dashboard", icon: LayoutDashboard, tier: 1 },
  { href: "/products", label: "Products", short: "Products", icon: Package, tier: 1 },
  { href: "/campaigns", label: "Campaigns", short: "Campaigns", icon: Target, tier: 1 },
  { href: "/creatives", label: "Creatives", short: "Creatives", icon: Megaphone, tier: 1 },
  { href: "/orders", label: "Orders & parcels", short: "Orders", icon: ClipboardList, tier: 1 },
  { href: "/expenses", label: "Expenses", short: "Expenses", icon: Receipt, tier: 2 },
  { href: "/syncs", label: "MDM sync", short: "MDM sync", icon: RefreshCw, tier: 2 },
  { href: "/simulator", label: "Breakeven CPA", short: "Breakeven", icon: Calculator, tier: 3 },
  { href: "/imports", label: "Imports", short: "Imports", icon: FileUp, tier: 3 },
  { href: "/settings", label: "Settings", short: "Settings", icon: Settings, tier: 3 },
] as const;

export function isActive(href: string, pathname: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
