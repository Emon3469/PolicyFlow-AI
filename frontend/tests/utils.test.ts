import { describe, expect, it } from "vitest";
import { SOURCE_ORDER, sourceMeta } from "@/lib/sources";
import { cn, formatBytes, formatDate, splitNumber, timeAgo } from "@/lib/utils";

describe("utils", () => {
  it("formats byte sizes", () => {
    expect(formatBytes(0)).toBe("—");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(27703)).toBe("27 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("splits numbers into whole and fraction parts", () => {
    expect(splitNumber(3.24)).toEqual({ whole: "3", fraction: ".2" });
    expect(splitNumber(1234.5, 2)).toEqual({ whole: "1,234", fraction: ".50" });
    expect(splitNumber(7, 0)).toEqual({ whole: "7", fraction: "" });
  });

  it("describes relative time", () => {
    const now = Date.now();
    expect(timeAgo(new Date(now - 10_000).toISOString())).toBe("just now");
    expect(timeAgo(new Date(now - 5 * 60_000).toISOString())).toBe("5m ago");
    expect(timeAgo(new Date(now - 3 * 3_600_000).toISOString())).toBe("3h ago");
  });

  it("handles invalid dates", () => {
    expect(formatDate("not-a-date")).toBe("—");
  });

  it("merges tailwind classes", () => {
    expect(cn("px-2", false && "hidden", "px-4")).toBe("px-4");
  });
});

describe("sources", () => {
  it("has metadata for every known answer source", () => {
    for (const key of SOURCE_ORDER) {
      const meta = sourceMeta(key);
      expect(meta.label).toBeTruthy();
      expect(meta.color).toMatch(/^var\(--/);
    }
  });

  it("falls back gracefully for unknown sources", () => {
    expect(sourceMeta("mystery").label).toBe("mystery");
    expect(sourceMeta("").label).toBe("Unknown");
  });
});
