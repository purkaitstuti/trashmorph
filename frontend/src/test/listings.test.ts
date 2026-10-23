import { describe, expect, it } from "vitest";
import { NEXT_ACTIONS, priceLabel } from "../lib/listings";
import { listingSchema } from "../lib/schemas";

const base = { title: "Glass jars", category: "glass", quantity: "10", unit: "items", condition: "good", listing_type: "free" as const, location_label: "Kolkata" };

describe("listingSchema", () => {
  it("accepts a free listing", () => expect(listingSchema.safeParse(base).success).toBe(true));
  it("requires a price for priced listings", () => {
    expect(listingSchema.safeParse({ ...base, listing_type: "price" }).success).toBe(false);
    expect(listingSchema.safeParse({ ...base, listing_type: "price", price: "25" }).success).toBe(true);
  });
  it("rejects bad quantity, missing category and short titles", () => {
    expect(listingSchema.safeParse({ ...base, quantity: "0" }).success).toBe(false);
    expect(listingSchema.safeParse({ ...base, category: "" }).success).toBe(false);
    expect(listingSchema.safeParse({ ...base, title: "ab" }).success).toBe(false);
  });
});

describe("listing helpers", () => {
  it("labels free, exchange and priced listings", () => {
    expect(priceLabel({ listing_type: "free", price: null })).toBe("Free");
    expect(priceLabel({ listing_type: "exchange", price: null })).toBe("For exchange");
    expect(priceLabel({ listing_type: "price", price: 25 })).toContain("25");
  });
  it("offers no actions on finished listings", () => {
    expect(NEXT_ACTIONS.completed).toEqual([]);
    expect(NEXT_ACTIONS.cancelled).toEqual([]);
    expect(NEXT_ACTIONS.draft.map(([s]) => s)).toEqual(["active", "cancelled"]);
  });
});
