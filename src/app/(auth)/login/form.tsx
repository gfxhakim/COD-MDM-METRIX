"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { loginAction } from "../actions";

export function LoginForm({ showDemoHint }: { showDemoHint: boolean }) {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-muted">See which products and creatives make delivered profit.</p>
      <form action={action} className="mt-6 flex flex-col gap-4">
        <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Password" htmlFor="password"><Input id="password" name="password" type="password" autoComplete="current-password" required /></Field>
        {state?.error ? <p className="text-sm text-negative" role="alert">{state.error}</p> : null}
        <Button variant="primary" type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        New here? <Link className="text-positive hover:underline" href="/signup">Create a workspace</Link>
      </p>
      {showDemoHint ? (
        <p className="mt-4 rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted">
          Development demo: <span className="font-mono text-fg">demo@codflow.local</span> / <span className="font-mono text-fg">demo-password-123</span>
        </p>
      ) : null}
    </Card>
  );
}
