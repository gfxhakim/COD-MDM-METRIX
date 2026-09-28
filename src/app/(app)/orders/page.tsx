import type { Metadata } from "next";
import { OrdersView } from "./orders-view";

export const metadata: Metadata = { title: "Orders & parcels" };

const PARCEL_STATUSES = ["PENDING", "CONFIRMED", "SHIPPED", "DELIVERED", "RETURNED", "LOST", "CANCELED", "EXCHANGED", "UNKNOWN"] as const;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ps = typeof sp.parcelStatus === "string" ? sp.parcelStatus : undefined;
  const initialParcelStatus = PARCEL_STATUSES.find((s) => s === ps);
  return <OrdersView initialParcelStatus={initialParcelStatus} />;
}
