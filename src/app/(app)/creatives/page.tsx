import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { CreativesView } from "./creatives-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Creatives") };
}

export default async function CreativesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  // ?product= keeps the product pick: all, each, none or a product's ID (src/domain/creativeProducts.ts).
  const product = typeof sp.product === "string" ? sp.product.slice(0, 64) : undefined;
  return <CreativesView initialProduct={product} />;
}
