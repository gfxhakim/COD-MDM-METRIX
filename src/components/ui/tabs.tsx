"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as React from "react";
import { useSlidingPill } from "@/components/ui/sliding-pill";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("animate-rise", className)} {...props} />;
}

export function TabsList({ className, children, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  const { boxRef, pill } = useSlidingPill<HTMLDivElement>();
  return (
    <TabsPrimitive.List ref={boxRef} data-slide="" className={cn("no-scrollbar relative flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-surface p-1 shadow-card", className)} {...props}>
      {pill}
      {children}
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "slide-item press whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium text-muted hover:text-fg data-[state=active]:bg-brand data-[state=active]:glow data-[state=active]:text-white",
        className,
      )}
      {...props}
    />
  );
}
