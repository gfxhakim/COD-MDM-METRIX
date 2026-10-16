import { Clapperboard, HandCoins, Import, LayoutDashboard, Package, Receipt, RefreshCw, Settings, ShoppingCart, Target, Wallet } from "lucide-react";
import { msg } from "@/i18n/core";

/**
 * The menu, in the order the owner asked for. Each page has its own red icon and its own way of
 * moving when the pointer is on it (`motion` names a nav-* keyframe in globals.css).
 */
export const NAV = [
  { href: "/", label: msg("Dashboard"), icon: LayoutDashboard, motion: "bars" },
  { href: "/profit", label: msg("Profit tracker"), icon: HandCoins, motion: "jingle" },
  { href: "/expenses", label: msg("Expenses"), icon: Receipt, motion: "wiggle" },
  { href: "/products", label: msg("Products"), icon: Package, motion: "hop" },
  { href: "/orders", label: msg("Orders & parcels"), icon: ShoppingCart, motion: "roll" },
  { href: "/creatives", label: msg("Creatives"), icon: Clapperboard, motion: "snap" },
  { href: "/campaigns", label: msg("Campaigns"), icon: Target, motion: "pulse" },
  { href: "/money", label: msg("Money & stock"), icon: Wallet, motion: "fly" },
  { href: "/syncs", label: msg("MDM sync"), icon: RefreshCw, motion: "spin" },
  { href: "/imports", label: msg("Imports"), icon: Import, motion: "drop" },
  { href: "/settings", label: msg("Settings"), icon: Settings, motion: "spin" },
] as const;

export type NavItem = (typeof NAV)[number];

export function navItem(href: NavItem["href"]): NavItem {
  return NAV.find((n) => n.href === href)!;
}

export function isActive(href: string, pathname: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
