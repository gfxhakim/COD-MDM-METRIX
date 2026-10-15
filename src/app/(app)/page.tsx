import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { DashboardView } from "./dashboard-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Dashboard") };
}

export default function DashboardPage() {
  return <DashboardView />;
}
