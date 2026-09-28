import type { Metadata } from "next";
import { SimulatorView } from "./simulator-view";

export const metadata: Metadata = { title: "Breakeven CPA" };

export default async function SimulatorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return <SimulatorView initialProductId={typeof sp.productId === "string" ? sp.productId : ""} />;
}
