import { ComingSoon } from "@/components/app/coming-soon";

export const metadata = { title: "Creatives" };

export default function Page() {
  return <ComingSoon title="Creative attribution matrix" description="Which Meta creatives produce delivered profit, not just cheap leads." milestone={2} detail="Server-side aggregated matrix with CPCO, CPDO, delivery and RTO rates, true POAS, verdicts, unattributed and unmatched-spend buckets, and CSV export." />;
}
