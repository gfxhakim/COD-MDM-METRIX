import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/shell";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Providers } from "@/lib/trpc/client";
import { getSessionUser, WORKSPACE_COOKIE } from "@/server/auth/session";
import { listWorkspacesForUser } from "@/server/repositories/workspaces";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const workspaces = await listWorkspacesForUser(user.id);
  if (workspaces.length === 0) redirect("/login");
  const preferred = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  // Membership-checked: the cookie only selects among workspaces this user belongs to.
  const current = workspaces.find((w) => w.id === preferred) ?? workspaces[0];
  return (
    <Providers key={current.id} workspaceId={current.id}>
      <TooltipProvider>
        <ToastProvider>
          <AppShell current={current} workspaces={workspaces} user={user}>
            {children}
          </AppShell>
        </ToastProvider>
      </TooltipProvider>
    </Providers>
  );
}
