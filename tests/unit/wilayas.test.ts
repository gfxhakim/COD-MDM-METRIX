import { describe, expect, it } from "vitest";
import { WILAYAS, mdmWilaya, sameWilaya, wilayaCode, wilayaName } from "@/domain/wilayas";

describe("wilayas", () => {
  it("lists the 58 wilayas once each, with names that never point at two wilayas", () => {
    expect(WILAYAS.map((w) => w.code)).toEqual(Array.from({ length: 58 }, (_, i) => i + 1));
    for (const w of WILAYAS) for (const name of [w.ar, w.fr, ...(w.also ?? [])]) expect(wilayaCode(name), name).toBe(w.code);
  });

  it("reads French, Arabic and English names however they are spelled", () => {
    for (const s of ["Alger", "ALGER", "alger ", "Algiers", "الجزائر", "الجزائر العاصمة", "Wilaya d'Alger", "ولاية الجزائر"]) expect(wilayaName(s), s).toBe("الجزائر");
    for (const s of ["Béjaïa", "Bejaia", "bejaia", "بجاية", "بِجَايَة"]) expect(wilayaName(s), s).toBe("بجاية");
    for (const s of ["Oum El Bouaghi", "Oum el-Bouaghi", "ام البواقي", "أم البواقي"]) expect(wilayaName(s), s).toBe("أم البواقي");
    for (const s of ["El Oued", "Oued", "الوادي", "وادي سوف"]) expect(wilayaName(s), s).toBe("الوادي");
    for (const s of ["Bordj Bou Arreridj", "Bordj Bou Arréridj", "برج بو عريريج"]) expect(wilayaName(s), s).toBe("برج بوعريريج");
    expect(wilayaName("M'sila")).toBe("المسيلة");
    expect(wilayaName("Msila")).toBe("المسيلة");
    expect(wilayaName("Tamanghasset")).toBe("تمنراست");
  });

  it("reads codes and names with their number", () => {
    expect(wilayaCode("16")).toBe(16);
    expect(wilayaCode("06")).toBe(6);
    expect(wilayaCode("DZ-31")).toBe(31);
    expect(wilayaName("31 - Oran")).toBe("وهران");
    expect(wilayaName("16- الجزائر")).toBe("الجزائر");
    expect(wilayaName("Oran (31)")).toBe("وهران");
    // The name wins over a wrong number; a number alone is enough.
    expect(wilayaName("16 - Oran")).toBe("وهران");
    expect(wilayaName("25 - Somewhere")).toBe("قسنطينة");
    expect(wilayaCode("59")).toBeNull();
    expect(wilayaCode("0")).toBeNull();
  });

  it("keeps what it doesn't recognise, and nothing for empty values", () => {
    expect(wilayaName("  Atlantis ")).toBe("Atlantis");
    expect(wilayaName("")).toBeNull();
    expect(wilayaName(null)).toBeNull();
    expect(wilayaCode("Atlantis")).toBeNull();
  });

  it("takes MDM's code when its name is unknown", () => {
    expect(mdmWilaya("Alger", "16")).toBe("الجزائر");
    expect(mdmWilaya("Somewhere", "31")).toBe("وهران");
    expect(mdmWilaya(null, "31")).toBe("وهران");
    expect(mdmWilaya("Somewhere", null)).toBe("Somewhere");
    expect(mdmWilaya(null, null)).toBeNull();
  });

  it("compares wilayas across languages", () => {
    expect(sameWilaya("Béjaïa", "بجاية")).toBe(true);
    expect(sameWilaya("bejaia", "Oran")).toBe(false);
    expect(sameWilaya("Atlantis", "atlantis")).toBe(true);
    expect(sameWilaya(null, "Oran")).toBe(false);
  });
});
