import type { Metadata } from "next";
import { ProfitView } from "./profit-view";

export const metadata: Metadata = { title: "Profit tracker" };

export default async function ProfitPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return <ProfitView initialProductId={typeof sp.productId === "string" ? sp.productId : ""} />;
}
