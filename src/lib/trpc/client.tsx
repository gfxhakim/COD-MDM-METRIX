"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { useState } from "react";
import superjson from "superjson";
import type { AppRouter } from "@/server/trpc/root";

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (count, err) => {
          if (err instanceof TRPCClientError && ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "BAD_REQUEST"].includes(err.data?.code)) return false;
          return count < 2;
        },
      },
    },
  });
}

export function Providers({ workspaceId, children }: { workspaceId: string | null; children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
          headers: () => (workspaceId ? { "x-workspace-id": workspaceId } : {}),
        }),
      ],
    }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}

export function errorMessage(err: unknown): string {
  if (err instanceof TRPCClientError) {
    const zod = err.data?.zodError as { fieldErrors?: Record<string, string[]>; formErrors?: string[] } | null;
    if (zod) {
      const first = Object.entries(zod.fieldErrors ?? {})[0];
      if (first) return `${first[0]}: ${first[1][0]}`;
      if (zod.formErrors?.[0]) return zod.formErrors[0];
    }
    return err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong";
}
