import { describe, expect, it } from "vitest";
import { CostVersionError, planNewCostVersion, selectCostVersion } from "@/domain/costVersions";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const versions = [
  { id: "v1", effectiveFrom: d("2026-01-01"), effectiveTo: d("2026-03-01") },
  { id: "v2", effectiveFrom: d("2026-03-01"), effectiveTo: null },
];

describe("cost version effective dates", () => {
  it("selects the version in effect at a date", () => {
    expect(selectCostVersion(versions, d("2026-02-15"))?.id).toBe("v1");
    expect(selectCostVersion(versions, d("2026-03-01"))?.id).toBe("v2"); // boundary belongs to the new version
    expect(selectCostVersion(versions, d("2027-01-01"))?.id).toBe("v2");
    expect(selectCostVersion(versions, d("2025-12-31"))).toBeNull();
  });

  it("appends new versions and closes the latest one", () => {
    expect(planNewCostVersion(versions, d("2026-04-01"))).toEqual({ closeId: "v2" });
    expect(planNewCostVersion([], d("2026-04-01"))).toEqual({ closeId: null });
  });

  it("refuses to backdate over existing history", () => {
    expect(() => planNewCostVersion(versions, d("2026-02-01"))).toThrow(CostVersionError);
    expect(() => planNewCostVersion(versions, d("2026-03-01"))).toThrow(CostVersionError);
  });
});
