import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { OrdersView } from "./orders-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Orders & parcels") };
}

const PARCEL_STATUSES = ["PENDING", "CONFIRMED", "SHIPPED", "DELIVERED", "RETURNED", "LOST", "CANCELED", "EXCHANGED", "UNKNOWN"] as const;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ps = typeof sp.parcelStatus === "string" ? sp.parcelStatus : undefined;
  const initialParcelStatus = PARCEL_STATUSES.find((s) => s === ps);
  return <OrdersView initialParcelStatus={initialParcelStatus} />;
}
