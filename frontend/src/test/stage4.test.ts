import { describe, expect, it } from "vitest";
import { checkImage, pct, scanCategoryLabel } from "../lib/scanner";

describe("checkImage", () => {
  it("accepts supported types under the limit", () => {
    expect(checkImage({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(checkImage({ type: "image/webp", size: 5 * 1024 * 1024 })).toBeNull();
  });
  it("rejects other types, empty files and oversized files", () => {
    expect(checkImage({ type: "application/pdf", size: 1000 })).toMatch(/JPG, PNG or WebP/);
    expect(checkImage({ type: "image/gif", size: 1000 })).not.toBeNull();
    expect(checkImage({ type: "image/png", size: 0 })).toMatch(/empty/);
    expect(checkImage({ type: "image/png", size: 5 * 1024 * 1024 + 1 })).toMatch(/5 MB/);
  });
});

describe("scan labels", () => {
  it("shows uncertain results as 'Not sure' and formats confidence", () => {
    expect(scanCategoryLabel("uncertain", (v) => v.toUpperCase())).toBe("Not sure");
    expect(scanCategoryLabel("glass", (v) => v.toUpperCase())).toBe("GLASS");
    expect(pct(0.934)).toBe("93%");
  });
});
