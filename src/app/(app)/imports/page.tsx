import type { Metadata } from "next";
import { ImportsView } from "./imports-view";

export const metadata: Metadata = { title: "Imports" };

export default async function ImportsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <ImportsView tab={tab ?? "orders"} />;
}
