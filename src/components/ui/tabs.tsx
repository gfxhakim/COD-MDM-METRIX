"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("no-scrollbar flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-surface p-1 shadow-card", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-fg data-[state=active]:bg-brand data-[state=active]:glow data-[state=active]:text-white",
        className,
      )}
      {...props}
    />
  );
}
