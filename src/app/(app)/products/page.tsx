import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { ProductsView } from "./products-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Products") };
}

export default function ProductsPage() {
  return <ProductsView />;
}
