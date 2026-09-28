import { Calculator, ClipboardList, FileUp, LayoutDashboard, Megaphone, Package, RefreshCw, Receipt, Settings } from "lucide-react";

export const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/products", label: "Products", icon: Package },
  { href: "/simulator", label: "Breakeven CPA", icon: Calculator },
  { href: "/creatives", label: "Creatives", icon: Megaphone },
  { href: "/orders", label: "Orders & parcels", icon: ClipboardList },
  { href: "/expenses", label: "Expenses", icon: Receipt },
  { href: "/imports", label: "Imports", icon: FileUp },
  { href: "/syncs", label: "MDM sync", icon: RefreshCw },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;
