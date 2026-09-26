export const EXPENSE_CATEGORIES = [
  ["AI_TOOLS", "AI Tools"],
  ["SOFTWARE", "Software"],
  ["OFFICE", "Office"],
  ["DOMAINS_PROXIES", "Domains/Proxies"],
  ["BANK_FEES", "Bank Fees"],
  ["CALL_CENTER", "Call Center"],
  ["PACKAGING", "Packaging"],
  ["WAREHOUSE", "Warehouse"],
  ["OTHER", "Other"],
] as const;

export type ExpenseCategoryKey = (typeof EXPENSE_CATEGORIES)[number][0];
export const categoryLabel = (c: string) => EXPENSE_CATEGORIES.find(([k]) => k === c)?.[1] ?? c;
