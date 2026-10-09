import { describe, expect, it } from "vitest";
import { bringsEverything, mdmProductIdOf, orderBrought, widens, type ProductChoices } from "@/domain/mdmChoices";

const day = (d: string) => new Date(`${d}T00:00:00Z`);
const choices = (bringNew: boolean, rules: [string, boolean, string | null][]): ProductChoices => ({
  bringNew,
  rules: new Map(rules.map(([id, bring, since]) => [id, { bring, since: since ? day(since) : null }])),
});

describe("MDM product choices", () => {
  it("reads a line's product: the product a variant belongs to, else its own ID", () => {
    expect(mdmProductIdOf({ ref: "VAR-1", variantOf: "PRD-1" })).toBe("PRD-1");
    expect(mdmProductIdOf({ ref: " PRD-2 ", variantOf: null })).toBe("PRD-2");
    expect(mdmProductIdOf({ ref: null, variantOf: null })).toBeNull();
  });

  it("brings an order in when one of its products is, from that product's first day", () => {
    const c = choices(true, [["LAMP", true, "2026-09-21"], ["FAN", false, null]]);
    expect(orderBrought(c, ["LAMP"], day("2026-09-21"))).toBe(true);
    expect(orderBrought(c, ["LAMP"], day("2026-09-20"))).toBe(false);
    expect(orderBrought(c, ["FAN"], day("2026-09-25"))).toBe(false);
    expect(orderBrought(c, ["FAN", "LAMP"], day("2026-09-25"))).toBe(true);
    // Unknown products follow the choice for new products; orders without product IDs always come in.
    expect(orderBrought(c, ["NEW"], day("2026-09-25"))).toBe(true);
    expect(orderBrought(choices(false, []), ["NEW"], day("2026-09-25"))).toBe(false);
    expect(orderBrought(choices(false, []), [null], day("2026-09-25"))).toBe(true);
  });

  it("knows when nothing is left out, and when a change brings in more", () => {
    expect(bringsEverything(choices(true, [["LAMP", true, null]]))).toBe(true);
    expect(bringsEverything(choices(true, [["LAMP", true, "2026-09-01"]]))).toBe(false);
    expect(bringsEverything(choices(false, []))).toBe(false);
    const off = { bring: false, since: null };
    const all = { bring: true, since: null };
    const sept = { bring: true, since: day("2026-09-01") };
    const oct = { bring: true, since: day("2026-10-01") };
    expect(widens(off, all)).toBe(true);
    expect(widens(oct, sept)).toBe(true);
    expect(widens(sept, all)).toBe(true);
    expect(widens(all, sept)).toBe(false);
    expect(widens(sept, oct)).toBe(false);
    expect(widens(all, off)).toBe(false);
  });
});
