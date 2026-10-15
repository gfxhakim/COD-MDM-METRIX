import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { ProfitView } from "./profit-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Profit tracker") };
}

export default async function ProfitPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return <ProfitView initialProductId={typeof sp.productId === "string" ? sp.productId : ""} />;
}
