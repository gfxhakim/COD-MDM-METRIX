import type { Metadata } from "next";
import { CreativesView } from "./creatives-view";

export const metadata: Metadata = { title: "Creatives" };

export default function CreativesPage() {
  return <CreativesView />;
}
