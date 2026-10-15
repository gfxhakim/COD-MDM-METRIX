import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { Logo } from "@/components/app/logo";
import { LanguageSwitch } from "@/i18n/language-switch";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getSessionUser()) redirect("/");
  return (
    <main className="relative grid min-h-screen place-items-center bg-[radial-gradient(ellipse_at_top,rgba(232,24,44,0.12),transparent_60%)] px-4 py-10">
      <LanguageSwitch className="absolute end-4 top-4" />
      <div className="animate-rise w-full max-w-sm">
        <div className="mb-8 flex justify-center"><Logo /></div>
        {children}
      </div>
    </main>
  );
}
