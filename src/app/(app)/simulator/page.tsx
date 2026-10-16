import { redirect } from "next/navigation";

/** The breakeven simulator is now the What if part of the Profit tracker, starting from the product's real numbers. */
export default async function SimulatorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const productId = typeof sp.productId === "string" ? sp.productId : "";
  redirect(productId ? `/profit?productId=${encodeURIComponent(productId)}#what-if` : "/profit#what-if");
}
