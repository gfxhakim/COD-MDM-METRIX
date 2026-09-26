import { ComingSoon } from "@/components/app/coming-soon";

export const metadata = { title: "Imports" };

export default function Page() {
  return <ComingSoon title="Imports" description="Orders, Meta ad spend, expenses and bank transactions from CSV." milestone={3} detail="Upload, header detection, column mapping, 25-row preview, validation with row errors, deduplication and import history with downloadable error CSVs." />;
}
