import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { SyncView } from "./sync-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("MDM sync") };
}

export default function SyncPage() {
  return <SyncView />;
}
