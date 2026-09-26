"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession, destroySession, getSessionUser, setActiveWorkspaceCookie } from "@/server/auth/session";
import { createWorkspace } from "@/server/repositories/workspaces";
import { rateLimit, RateLimitError } from "@/server/rateLimit";

export type AuthState = { error?: string } | undefined;

async function clientKey() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });

export async function loginAction(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = loginSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Enter a valid email and password." };
  try {
    await rateLimit(`login:${await clientKey()}:${parsed.data.email}`, 10, 15 * 60);
  } catch (e) {
    if (e instanceof RateLimitError) return { error: e.message };
    throw e;
  }
  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  // Same message for unknown email and wrong password to avoid account enumeration.
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) return { error: "Email or password is incorrect." };
  await createSession(user.id);
  redirect("/");
}

const signupSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(10, "Password must be at least 10 characters").max(200),
  workspaceName: z.string().trim().min(2).max(80),
});

export async function signupAction(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = signupSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form fields." };
  try {
    await rateLimit(`signup:${await clientKey()}`, 5, 60 * 60);
  } catch (e) {
    if (e instanceof RateLimitError) return { error: e.message };
    throw e;
  }
  const exists = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (exists) return { error: "An account with this email already exists. Sign in instead." };
  const passwordHash = await hashPassword(parsed.data.password);
  const workspace = await db.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email: parsed.data.email, name: parsed.data.name, passwordHash } });
    const ws = await createWorkspace(user.id, { name: parsed.data.workspaceName }, tx);
    return { ws, user };
  });
  await createSession(workspace.user.id);
  await setActiveWorkspaceCookie(workspace.ws.id);
  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

/** Switch the active workspace after verifying membership server-side. */
export async function switchWorkspaceAction(workspaceId: string) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const member = await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: user.id } } });
  if (!member) return { error: "You are not a member of that workspace" };
  await setActiveWorkspaceCookie(workspaceId);
  return { ok: true };
}
