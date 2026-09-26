import type { Metadata } from "next";
import { LoginForm } from "./form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return <LoginForm showDemoHint={process.env.NODE_ENV !== "production"} />;
}
