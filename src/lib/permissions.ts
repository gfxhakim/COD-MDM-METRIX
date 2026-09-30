import type { Role } from "@prisma/client";

/** Permission matrix. Keep in one place so UI and server agree. */
export const PERMISSIONS = {
  "workspace.manage": ["OWNER"],
  "members.manage": ["OWNER"],
  "integrations.manage": ["OWNER", "ADMIN"],
  "catalog.write": ["OWNER", "ADMIN"],
  "expenses.write": ["OWNER", "ADMIN"],
  "imports.write": ["OWNER", "ADMIN"],
  "sync.run": ["OWNER", "ADMIN", "OPERATOR"],
  "orders.write": ["OWNER", "ADMIN", "OPERATOR"],
  "orders.match": ["OWNER", "ADMIN", "OPERATOR"],
  "settings.economics": ["OWNER", "ADMIN"],
  "audit.read": ["OWNER", "ADMIN"],
  "data.read": ["OWNER", "ADMIN", "ANALYST", "OPERATOR"],
  /** Customer names, phones and addresses in full (others see them masked, and exports leave them out). */
  "customers.read": ["OWNER", "ADMIN", "OPERATOR"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

