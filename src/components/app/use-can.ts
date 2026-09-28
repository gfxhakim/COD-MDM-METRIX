"use client";

import { useQuery } from "@tanstack/react-query";
import { can, type Permission } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc/client";

/** UI hint only. Every mutation is authorized again on the server. */
export function useCan(permission: Permission): boolean {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.workspace.getCurrent.queryOptions());
  return data ? can(data.role, permission) : false;
}
