"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { useT } from "@/i18n/client";
import { loginAction } from "../actions";

export function LoginForm({ showDemoHint }: { showDemoHint: boolean }) {
  const { t, tx } = useT();
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <Card className="p-6">
      <h1 className="text-2xl font-extrabold tracking-tight">{t("Sign in")}</h1>
      <p className="mt-1 text-sm text-muted">{t("See which products and creatives make delivered profit.")}</p>
      <form action={action} className="mt-6 flex flex-col gap-4">
        <Field label={t("Email")} htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
        <Field label={t("Password")} htmlFor="password"><Input id="password" name="password" type="password" autoComplete="current-password" required /></Field>
        {state?.error ? <p className="text-sm text-negative" role="alert">{state.error}</p> : null}
        <Button variant="primary" type="submit" disabled={pending}>{pending ? t("Signing in…") : t("Sign in")}</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        {tx("New here? {link}", { link: <Link className="font-semibold text-brand-strong hover:underline" href="/signup">{t("Create a workspace")}</Link> })}
      </p>
      {showDemoHint ? (
        <p className="mt-4 rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted">
          {tx("Development demo: {email} / {password}", { email: <span className="font-mono text-fg">demo@codflow.local</span>, password: <span className="font-mono text-fg">demo-password-123</span> })}
        </p>
      ) : null}
    </Card>
  );
}
