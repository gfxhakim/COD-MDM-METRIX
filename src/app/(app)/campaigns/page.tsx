import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { CampaignsView } from "./campaigns-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Campaigns") };
}

export default function CampaignsPage() {
  return <CampaignsView />;
}
