import { Calculator, Clapperboard, HandCoins, Import, LayoutDashboard, Package, Receipt, RefreshCw, Settings, ShoppingCart, Target, Wallet } from "lucide-react";

/**
 * The menu, in the order the owner asked for. Each page has its own red icon and its own way of
 * moving when the pointer is on it (`motion` names a nav-* keyframe in globals.css).
 */
export const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, motion: "bars" },
  { href: "/profit", label: "Profit tracker", icon: HandCoins, motion: "jingle" },
  { href: "/expenses", label: "Expenses", icon: Receipt, motion: "wiggle" },
  { href: "/products", label: "Products", icon: Package, motion: "hop" },
  { href: "/orders", label: "Orders & parcels", icon: ShoppingCart, motion: "roll" },
  { href: "/creatives", label: "Creatives", icon: Clapperboard, motion: "snap" },
  { href: "/campaigns", label: "Campaigns", icon: Target, motion: "pulse" },
  { href: "/money", label: "Money & stock", icon: Wallet, motion: "fly" },
  { href: "/syncs", label: "MDM sync", icon: RefreshCw, motion: "spin" },
  { href: "/simulator", label: "Breakeven CPA", icon: Calculator, motion: "tilt" },
  { href: "/imports", label: "Imports", icon: Import, motion: "drop" },
  { href: "/settings", label: "Settings", icon: Settings, motion: "spin" },
] as const;

export type NavItem = (typeof NAV)[number];

export function navItem(href: NavItem["href"]): NavItem {
  return NAV.find((n) => n.href === href)!;
}

export function isActive(href: string, pathname: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
