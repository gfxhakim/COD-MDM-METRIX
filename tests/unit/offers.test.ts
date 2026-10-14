import { describe, expect, it } from "vitest";
import { linesWithOffers, offerLabel, piecesSent } from "@/domain/offers";

describe("offers", () => {
  it("adds the free pieces an order doesn't list, and keeps an order's own bigger count", () => {
    expect(piecesSent(1, 1)).toBe(1);
    expect(piecesSent(1, 2)).toBe(2);
    expect(piecesSent(2, 2)).toBe(2);
    expect(piecesSent(4, 2)).toBe(4);
    expect(offerLabel(2)).toBe("Buy 1, get 1 free");
    expect(offerLabel(7)).toBe("7 pieces per order");
  });

  it("counts a product's lines together, so a free piece listed on its own line isn't added twice", () => {
    const pieces = (id: string) => (id === "lamp" ? 2 : 1);
    expect(linesWithOffers([{ productId: "lamp", quantity: 1 }], pieces)).toEqual([{ productId: "lamp", quantity: 2 }]);
    expect(linesWithOffers([{ productId: "lamp", quantity: 1 }, { productId: "lamp", quantity: 1 }], pieces)).toEqual([{ productId: "lamp", quantity: 1 }, { productId: "lamp", quantity: 1 }]);
    expect(linesWithOffers([{ productId: "lamp", quantity: 1 }, { productId: "cable", quantity: 1 }, { productId: null, quantity: 3 }], pieces)).toEqual([
      { productId: "lamp", quantity: 2 },
      { productId: "cable", quantity: 1 },
      { productId: null, quantity: 3 },
    ]);
  });
});
