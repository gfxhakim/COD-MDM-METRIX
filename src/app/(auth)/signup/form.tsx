"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { useT } from "@/i18n/client";
import { signupAction } from "../actions";

export function SignupForm() {
  const { t, tx } = useT();
  const [state, action, pending] = useActionState(signupAction, undefined);
  return (
    <Card className="p-6">
      <h1 className="text-2xl font-extrabold tracking-tight">{t("Create your workspace")}</h1>
      <p className="mt-1 text-sm text-muted">{t("One workspace per business. You become its owner.")}</p>
      <form action={action} className="mt-6 flex flex-col gap-4">
        <Field label={t("Your name")} htmlFor="name"><Input id="name" name="name" autoComplete="name" required /></Field>
        <Field label={t("Email")} htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
        <Field label={t("Password")} htmlFor="password" hint={t("At least 10 characters.")}><Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required /></Field>
        <Field label={t("Business name")} htmlFor="workspaceName"><Input id="workspaceName" name="workspaceName" required /></Field>
        {state?.error ? <p className="text-sm text-negative" role="alert">{state.error}</p> : null}
        <Button variant="primary" type="submit" disabled={pending}>{pending ? t("Creating…") : t("Create workspace")}</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        {tx("Already have an account? {link}", { link: <Link className="font-semibold text-brand-strong hover:underline" href="/login">{t("Sign in")}</Link> })}
      </p>
    </Card>
  );
}
