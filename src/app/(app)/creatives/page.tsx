import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { CreativesView } from "./creatives-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Creatives") };
}

export default function CreativesPage() {
  return <CreativesView />;
}
