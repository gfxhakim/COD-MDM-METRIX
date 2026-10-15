import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { ImportsView } from "./imports-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Imports") };
}

export default async function ImportsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <ImportsView tab={tab ?? "orders"} />;
}
