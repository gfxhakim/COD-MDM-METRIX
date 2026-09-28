import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { InputError } from "@/server/errors";
import type { WorkspaceContext } from "@/server/tenancy";
import { parseExchangeRates } from "@/domain/settings";
import { convertMinor } from "@/lib/money";

/** An amount entered in any currency, converted to the workspace currency. */
export type Converted = { amount: number; original: { amount: number; currency: string; rate: number } | null };

/**
 * Convert an amount the user entered in `currency` into the workspace currency.
 * Uses the rate sent with the form, else the workspace's rate from Settings.
 * Amounts already in the workspace currency are returned unchanged.
 */
export async function toWorkspaceCurrency(
  ctx: WorkspaceContext,
  amount: number,
  currency: string | undefined,
  rate: number | null | undefined,
  tx: Prisma.TransactionClient = db,
): Promise<Converted> {
  if (!currency || currency === ctx.currency) return { amount, original: null };
  let r = rate ?? null;
  if (!r) {
    const ws = await tx.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId }, select: { exchangeRates: true } });
    r = (parseExchangeRates(ws.exchangeRates) as Record<string, number | undefined>)[currency] ?? null;
  }
  if (!r) throw new InputError(`Enter how many ${ctx.currency} one ${currency} costs, or set a ${currency} rate in Settings → Economics & currencies`);
  return { amount: convertMinor(amount, currency, ctx.currency, r), original: { amount, currency, rate: r } };
}
