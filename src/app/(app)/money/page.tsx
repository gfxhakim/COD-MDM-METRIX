import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { MoneyView } from "./money-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Money & stock") };
}

export default function MoneyPage() {
  return <MoneyView />;
}
