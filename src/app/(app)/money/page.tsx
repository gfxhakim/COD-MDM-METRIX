import type { Metadata } from "next";
import { MoneyView } from "./money-view";

export const metadata: Metadata = { title: "Money & stock" };

export default function MoneyPage() {
  return <MoneyView />;
}
