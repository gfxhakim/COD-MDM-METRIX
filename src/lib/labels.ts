import { msg } from "@/i18n/core";
export const EXPENSE_CATEGORIES = [
  ["OWNER_PAY", msg("My pay")],
  ["SALARIES", msg("Employee pay")],
  ["AI_TOOLS", msg("AI Tools")],
  ["SOFTWARE", msg("Software")],
  ["OFFICE", msg("Office")],
  ["DOMAINS_PROXIES", msg("Domains/Proxies")],
  ["BANK_FEES", msg("Bank Fees")],
  ["CALL_CENTER", msg("Call Center")],
  ["PACKAGING", msg("Packaging")],
  ["WAREHOUSE", msg("Warehouse")],
  ["OTHER_ADS", msg("Other ads (TikTok, Google…)")],
  ["CONTENT", msg("Content & creatives")],
  ["TRANSPORT", msg("Transport")],
  ["TAXES", msg("Taxes")],
  ["OTHER", msg("Other")],
] as const;

export type ExpenseCategoryKey = (typeof EXPENSE_CATEGORIES)[number][0];
export const categoryLabel = (c: string) => EXPENSE_CATEGORIES.find(([k]) => k === c)?.[1] ?? c;
