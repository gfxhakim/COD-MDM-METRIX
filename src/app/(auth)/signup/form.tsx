"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { signupAction } from "../actions";

export function SignupForm() {
  const [state, action, pending] = useActionState(signupAction, undefined);
  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold">Create your workspace</h1>
      <p className="mt-1 text-sm text-muted">One workspace per business. You become its owner.</p>
      <form action={action} className="mt-6 flex flex-col gap-4">
        <Field label="Your name" htmlFor="name"><Input id="name" name="name" autoComplete="name" required /></Field>
        <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters."><Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required /></Field>
        <Field label="Business name" htmlFor="workspaceName"><Input id="workspaceName" name="workspaceName" required /></Field>
        {state?.error ? <p className="text-sm text-negative" role="alert">{state.error}</p> : null}
        <Button variant="primary" type="submit" disabled={pending}>{pending ? "Creating…" : "Create workspace"}</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account? <Link className="text-positive hover:underline" href="/login">Sign in</Link>
      </p>
    </Card>
  );
}
