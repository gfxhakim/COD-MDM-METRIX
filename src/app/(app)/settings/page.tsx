import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { SettingsView } from "./settings-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Settings") };
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return <SettingsView initialTab={typeof sp.tab === "string" ? sp.tab : "workspace"} />;
}
