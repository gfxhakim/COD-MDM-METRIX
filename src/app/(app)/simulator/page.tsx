import { ComingSoon } from "@/components/app/coming-soon";

export const metadata = { title: "Breakeven CPA" };

export default function Page() {
  return <ComingSoon title="Breakeven CPA simulator" description="What can you afford to pay per order and still make delivered profit?" milestone={2} detail="Inputs P, C, S, R, K, D and Q with observed vs scenario rates, a delivery-rate × CPA sensitivity grid, and saved scenarios." />;
}
