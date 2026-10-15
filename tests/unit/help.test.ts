import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name.endsWith(".tsx") ? [path] : [];
  });
}

/** The opening tag of each `<Name …>` in the code: up to its `>` outside any `{…}`. */
function openingTags(code: string, name: string): { tag: string; line: number }[] {
  const out: { tag: string; line: number }[] = [];
  const start = new RegExp(`<${name}\\b`, "g");
  for (const m of code.matchAll(start)) {
    let depth = 0;
    let i = m.index + m[0].length;
    for (; i < code.length; i++) {
      const c = code[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push({ tag: code.slice(m.index, i + 1), line: code.slice(0, m.index).split("\n").length });
  }
  return out;
}

// HELP_ONLY=src/app/(app)/profit narrows the check to some files while their texts are being written.
const only = process.env.HELP_ONLY?.split(",").filter(Boolean) ?? [];

describe("explanations", () => {
  it("every form field has an ⓘ explanation (help)", () => {
    const missing: string[] = [];
    for (const file of pages(join(ROOT, "src/app"))) {
      const where = relative(ROOT, file);
      if (only.length && !only.some((o) => where.startsWith(o))) continue;
      for (const { tag, line } of openingTags(readFileSync(file, "utf8"), "Field")) {
        if (!/\bhelp=/.test(tag)) missing.push(`${where}:${line}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every card title has an ⓘ explanation (help)", () => {
    const missing: string[] = [];
    for (const file of pages(join(ROOT, "src/app"))) {
      const where = relative(ROOT, file);
      if (only.length && !only.some((o) => where.startsWith(o))) continue;
      for (const { tag, line } of openingTags(readFileSync(file, "utf8"), "CardHeader")) {
        if (!/\bhelp=/.test(tag)) missing.push(`${where}:${line}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
