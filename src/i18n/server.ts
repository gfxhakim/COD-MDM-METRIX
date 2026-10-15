import { cookies } from "next/headers";
import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { AR } from "./ar";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, makeT, type Dict, type Locale, type TFunction } from "./core";

/** The language picked in this browser, else the one saved on the signed-in account, else English. */
export async function getLocale(): Promise<Locale> {
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookie)) return cookie;
  const saved = (await getSessionUser())?.locale;
  return isLocale(saved) ? saved : DEFAULT_LOCALE;
}

export function dictFor(locale: Locale): Dict | null {
  return locale === "ar" ? AR : null;
}

/** `t` for server code (pages, actions). */
export async function getT(): Promise<TFunction> {
  return makeT(dictFor(await getLocale()));
}

const YEAR = 60 * 60 * 24 * 365;

/** Only from a server action or route handler: remembers the language in this browser. */
export async function setLocaleCookie(locale: Locale) {
  (await cookies()).set(LOCALE_COOKIE, locale, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: YEAR });
}

/**
 * At sign-in or sign-up: a language picked in this browser is saved on the account; with none,
 * the account's language is remembered in this browser.
 */
export async function syncLocaleAtSignIn(user: { id: string; locale: string | null }) {
  const picked = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(picked)) {
    if (picked !== user.locale) await db.user.update({ where: { id: user.id }, data: { locale: picked } });
  } else if (isLocale(user.locale)) {
    await setLocaleCookie(user.locale);
  }
}
