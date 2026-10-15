"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession, destroySession, getSessionUser, setActiveWorkspaceCookie } from "@/server/auth/session";
import { createWorkspace } from "@/server/repositories/workspaces";
import { msg } from "@/i18n/core";
import { getT, syncLocaleAtSignIn } from "@/i18n/server";
import { rateLimit, RateLimitError } from "@/server/rateLimit";

export type AuthState = { error?: string } | undefined;

async function clientKey() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });

export async function loginAction(_: AuthState, form: FormData): Promise<AuthState> {
  const t = await getT();
  const parsed = loginSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: t("Enter a valid email and password.") };
  try {
    await rateLimit(`login:${await clientKey()}:${parsed.data.email}`, 10, 15 * 60);
  } catch (e) {
    if (e instanceof RateLimitError) return { error: t("Too many attempts. Try again in {n}s.", { n: e.retryAfterSeconds }) };
    throw e;
  }
  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  // Same message for unknown email and wrong password to avoid account enumeration.
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) return { error: t("Email or password is incorrect.") };
  await createSession(user.id);
  await syncLocaleAtSignIn(user);
  redirect("/");
}

// The messages are zod's own English ones, written out so they can be shown in Arabic too.
const TOO_SHORT = msg("Too small: expected string to have >=2 characters");
const TOO_LONG = msg("Too big: expected string to have <=80 characters");
const signupSchema = z.object({
  name: z.string().trim().min(2, TOO_SHORT).max(80, TOO_LONG),
  email: z.string().trim().toLowerCase().email(msg("Invalid email address")),
  password: z.string().min(10, msg("Password must be at least 10 characters")).max(200, msg("Too big: expected string to have <=200 characters")),
  workspaceName: z.string().trim().min(2, TOO_SHORT).max(80, TOO_LONG),
});

export async function signupAction(_: AuthState, form: FormData): Promise<AuthState> {
  const t = await getT();
  const parsed = signupSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: t(parsed.error.issues[0]?.message ?? msg("Check the form fields.")) };
  try {
    await rateLimit(`signup:${await clientKey()}`, 5, 60 * 60);
  } catch (e) {
    if (e instanceof RateLimitError) return { error: t("Too many attempts. Try again in {n}s.", { n: e.retryAfterSeconds }) };
    throw e;
  }
  const exists = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (exists) return { error: t("An account with this email already exists. Sign in instead.") };
  const passwordHash = await hashPassword(parsed.data.password);
  const workspace = await db.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email: parsed.data.email, name: parsed.data.name, passwordHash } });
    const ws = await createWorkspace(user.id, { name: parsed.data.workspaceName }, tx);
    return { ws, user };
  });
  await createSession(workspace.user.id);
  await setActiveWorkspaceCookie(workspace.ws.id);
  await syncLocaleAtSignIn(workspace.user);
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
  if (!member) {
    const t = await getT();
    return { error: t("You are not a member of that workspace") };
  }
  await setActiveWorkspaceCookie(workspaceId);
  return { ok: true };
}
