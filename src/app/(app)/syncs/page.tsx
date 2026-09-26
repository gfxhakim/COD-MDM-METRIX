import { ComingSoon } from "@/components/app/coming-soon";

export const metadata = { title: "MDM sync" };

export default function Page() {
  return <ComingSoon title="MDM Express sync" description="Background parcel and order sync with progress, retries and unmatched-record review." milestone={4} detail="Manual and scheduled syncs, per-workspace locking, 429/5xx backoff, idempotent upserts, raw payload storage, unknown-status and unmatched-record queues, and retry of failed items." />;
}
