import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { LoginForm } from "./form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Sign in") };
}

export default function LoginPage() {
  return <LoginForm showDemoHint={process.env.NODE_ENV !== "production"} />;
}
