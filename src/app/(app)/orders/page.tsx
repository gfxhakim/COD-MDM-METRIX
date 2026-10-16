import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { OrdersView } from "./orders-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Orders & parcels") };
}

const ORDER_STATUSES = ["PENDING", "CONFIRMED", "CANCELED"] as const;
const PARCEL_STATUSES = ["PENDING", "CONFIRMED", "SHIPPED", "DELIVERED", "RETURNED", "LOST", "CANCELED", "EXCHANGED", "UNKNOWN"] as const;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ps = typeof sp.parcelStatus === "string" ? sp.parcelStatus : undefined;
  const text = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const day = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(text(k) ?? "") ? text(k) : undefined);
  // The Profit tracker links here with the product, the days and the status behind one of its numbers.
  return (
    <OrdersView
      initial={{
        parcelStatus: PARCEL_STATUSES.find((s) => s === ps),
        status: ORDER_STATUSES.find((s) => s === text("status")),
        productId: text("productId")?.slice(0, 64),
        from: day("from"),
        to: day("to"),
        counted: text("counted") === "1",
      }}
    />
  );
}
