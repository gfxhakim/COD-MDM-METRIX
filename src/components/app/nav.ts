/**
 * The side menu, in the order the owner asked for. Each page has its own emoji and its own
 * way of moving when the pointer is on it (`motion` names an emoji-* keyframe in globals.css).
 */
export const NAV = [
  { href: "/", label: "Dashboard", emoji: "📊", motion: "bars" },
  { href: "/profit", label: "Profit tracker", emoji: "💰", motion: "jingle" },
  { href: "/expenses", label: "Expenses", emoji: "🧾", motion: "wiggle" },
  { href: "/products", label: "Products", emoji: "📦", motion: "hop" },
  { href: "/orders", label: "Orders & parcels", emoji: "🛒", motion: "roll" },
  { href: "/creatives", label: "Creatives", emoji: "🎬", motion: "snap" },
  { href: "/campaigns", label: "Campaigns", emoji: "🎯", motion: "pulse" },
  { href: "/money", label: "Money & stock", emoji: "💸", motion: "fly" },
  { href: "/syncs", label: "MDM sync", emoji: "🔄", motion: "spin" },
  { href: "/simulator", label: "Breakeven CPA", emoji: "🧮", motion: "tilt" },
  { href: "/imports", label: "Imports", emoji: "📥", motion: "drop" },
  { href: "/settings", label: "Settings", emoji: "⚙️", motion: "spin" },
] as const;

/** Cookie remembering whether the side menu is folded down to its emojis on a computer. */
export const SIDEBAR_COOKIE = "cft_sidebar";

export function isActive(href: string, pathname: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
