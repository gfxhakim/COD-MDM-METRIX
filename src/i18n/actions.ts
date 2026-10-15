"use server";

import { db } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { isLocale } from "./core";
import { setLocaleCookie } from "./server";

/** Picks the language for this browser and, when signed in, for the account on every device. */
export async function setLocaleAction(locale: string) {
  if (!isLocale(locale)) return { error: "Unknown language" };
  await setLocaleCookie(locale);
  const user = await getSessionUser();
  if (user) await db.user.update({ where: { id: user.id }, data: { locale } });
  return { ok: true };
}
