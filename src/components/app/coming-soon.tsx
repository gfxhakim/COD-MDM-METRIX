import { Construction } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";

export function ComingSoon({ title, description, milestone, detail }: { title: string; description: string; milestone: number; detail: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card>
        <EmptyState icon={<Construction />} title={`Arrives in Milestone ${milestone}`} description={detail} />
      </Card>
    </>
  );
}
