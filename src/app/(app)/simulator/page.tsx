import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { SimulatorView } from "./simulator-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Breakeven CPA") };
}

export default async function SimulatorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return <SimulatorView initialProductId={typeof sp.productId === "string" ? sp.productId : ""} />;
}
