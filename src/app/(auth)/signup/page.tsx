import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { SignupForm } from "./form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Create workspace") };
}

export default function SignupPage() {
  return <SignupForm />;
}
