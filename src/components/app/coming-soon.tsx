"use client";

import { Construction } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { useT } from "@/i18n/client";

export function ComingSoon({ title, description, milestone, detail }: { title: string; description: string; milestone: number; detail: string }) {
  const { t } = useT();
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card>
        <EmptyState icon={<Construction />} title={t("Arrives in Milestone {n}", { n: milestone })} description={detail} />
      </Card>
    </>
  );
}
