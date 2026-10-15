import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { AR } from "@/i18n/ar";
import { interpolate, makeT, splitPlaceholders } from "@/i18n/core";

const ROOT = join(__dirname, "../..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "i18n" ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Every English text handed to t(), tx() or msg() as a plain string, and the files using it. */
function textsInCode(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const call = /\b(?:t|tx|msg)\(\s*(?:"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\$]|\\.)*)`)/g;
  for (const file of sources(join(ROOT, "src"))) {
    const code = readFileSync(file, "utf8");
    for (const m of code.matchAll(call)) {
      const text =
        m[1] !== undefined
          ? (JSON.parse(`"${m[1]}"`) as string)
          : (m[2] ?? m[3]).replace(/\\(['`\\])/g, "$1");
      const where = relative(ROOT, file);
      found.set(text, [...(found.get(text) ?? []), where]);
    }
  }
  return found;
}

const placeholders = (s: string) => splitPlaceholders(s).flatMap((p) => (typeof p === "string" ? [] : [p.name])).sort();

describe("Arabic texts", () => {
  const used = textsInCode();
  // I18N_ONLY=src/app/(app)/profit narrows the check to some files while a part is being translated.
  const only = process.env.I18N_ONLY?.split(",").filter(Boolean) ?? [];
  const inScope = (files: string[]) => only.length === 0 || files.some((f) => only.some((o) => f.startsWith(o)));

  it("has an Arabic text for every English text shown through t()", () => {
    const missing = [...used].filter(([text, files]) => inScope(files) && !(text in AR)).map(([text, files]) => `${files[0]}: ${text}`);
    expect(missing).toEqual([]);
  });

  it("keeps every {name} part of the English text in its Arabic", () => {
    const wrong = Object.entries(AR).filter(([en, ar]) => placeholders(en).join() !== placeholders(ar).join()).map(([en, ar]) => `${en} → ${ar}`);
    expect(wrong).toEqual([]);
  });

  it("has no empty Arabic texts and no English left in them", () => {
    const bad = Object.entries(AR).filter(([, ar]) => !ar.trim() || !/[؀-ۿ]/.test(ar)).map(([en]) => en);
    expect(bad).toEqual([]);
  });

  it("fills placeholders and falls back to English", () => {
    const t = makeT({ "{n} orders": "{n} طلبيات" });
    // In Arabic a filled-in number starts with an invisible left-to-right mark so "-826" keeps its minus in front.
    expect(t("{n} orders", { n: 3 })).toBe("\u200E3 طلبيات");
    expect(t("{n} orders", { n: "-DZD 826" })).toBe("\u200E-DZD 826 طلبيات");
    expect(t("{n} orders", { n: "وهران 31" })).toBe("وهران 31 طلبيات");
    expect(t("Not translated {x}", { x: "x" })).toBe("Not translated x");
    expect(makeT(null)("{n} orders", { n: -3 })).toBe("-3 orders");
    expect(interpolate("{a} and {b}", { a: "x" })).toBe("x and {b}");
    expect(makeT(null)("date::Placed")).toBe("Placed");
    expect(makeT({ "date::Placed": "تاريخ الطلبية" })("date::Placed")).toBe("تاريخ الطلبية");
  });
});
