import type { Metadata } from "next";
import { SignupForm } from "./form";

export const metadata: Metadata = { title: "Create workspace" };

export default function SignupPage() {
  return <SignupForm />;
}
