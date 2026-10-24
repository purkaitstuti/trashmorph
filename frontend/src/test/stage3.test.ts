import { describe, expect, it } from "vitest";
import { buildLabel } from "../lib/geo";
import { collectionSchema, recyclerSchema } from "../lib/schemas";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return iso(d); };

describe("buildLabel (location box autofill)", () => {
  it("joins area, city and state without duplicates", () => {
    expect(buildLabel({ suburb: "Salt Lake", city: "Kolkata", state: "West Bengal" })).toBe("Salt Lake, Kolkata, West Bengal");
    expect(buildLabel({ city: "Delhi", state: "Delhi" })).toBe("Delhi");
  });
  it("falls back through town and village and handles empty input", () => {
    expect(buildLabel({ village: "Rampur", county: "Hooghly", state: "West Bengal" })).toBe("Rampur, Hooghly, West Bengal");
    expect(buildLabel({})).toBe("");
  });
});

describe("collectionSchema", () => {
  const base = { quantity: "2", requested_date: day(2), time_window: "any" as const };
  it("accepts a future date and today", () => {
    expect(collectionSchema.safeParse(base).success).toBe(true);
    expect(collectionSchema.safeParse({ ...base, requested_date: day(0) }).success).toBe(true);
  });
  it("rejects past dates, empty dates and bad quantities", () => {
    expect(collectionSchema.safeParse({ ...base, requested_date: day(-1) }).success).toBe(false);
    expect(collectionSchema.safeParse({ ...base, requested_date: "" }).success).toBe(false);
    expect(collectionSchema.safeParse({ ...base, quantity: "0" }).success).toBe(false);
  });
});

describe("recyclerSchema", () => {
  it("requires a name and type", () => {
    expect(recyclerSchema.safeParse({ name: "Green Point", recycler_type: "recycling_center" }).success).toBe(true);
    expect(recyclerSchema.safeParse({ name: "G", recycler_type: "recycling_center" }).success).toBe(false);
    expect(recyclerSchema.safeParse({ name: "Green Point", recycler_type: "" }).success).toBe(false);
  });
});
