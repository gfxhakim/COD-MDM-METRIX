import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { ExpensesView } from "./expenses-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Expenses") };
}

export default function ExpensesPage() {
  return <ExpensesView />;
}
