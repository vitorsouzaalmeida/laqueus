import { describe, expect, it } from "vitest";
import { ccBand, cycleSeverity, isHub, rankScale } from "../src/judgement";

describe("ccBand", () => {
  it.each([
    [1, "low"],
    [5, "low"],
    [10, "low"],
    [11, "moderate"],
    [15, "moderate"],
    [16, "high"],
    [100, "high"],
  ] as const)("CC %d → %s", (cc, expected) => {
    expect(ccBand(cc)).toBe(expected);
  });
});

describe("rankScale", () => {
  it("ranks values by how many are strictly smaller", () => {
    const scale = rankScale([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(scale.rank(0)).toBe(0);
    expect(scale.rank(5)).toBe(50);
    expect(scale.rank(9)).toBe(90);
    expect(scale.population).toBe(10);
  });

  it("assigns bands based on percentile rank", () => {
    const values = Array.from({ length: 100 }, (_, i) => i);
    const scale = rankScale(values);

    expect(scale.band(0)).toBe("low");
    expect(scale.band(74)).toBe("low");
    expect(scale.band(75)).toBe("moderate");
    expect(scale.band(89)).toBe("moderate");
    expect(scale.band(90)).toBe("high");
    expect(scale.band(94)).toBe("high");
    expect(scale.band(95)).toBe("extreme");
    expect(scale.band(99)).toBe("extreme");
  });

  it("reports cutoff values where bands start", () => {
    const values = Array.from({ length: 100 }, (_, i) => i);
    const scale = rankScale(values);

    expect(scale.cutoffs).toEqual({ moderate: 75, high: 90, extreme: 95 });
  });

  it("returns null cutoffs when the population is too small to reach a band", () => {
    const scale = rankScale([0, 1, 2]);
    expect(scale.cutoffs.extreme).toBeNull();
  });

  it("handles all-same values: everything is P0 low", () => {
    const scale = rankScale([5, 5, 5, 5, 5]);
    expect(scale.rank(5)).toBe(0);
    expect(scale.band(5)).toBe("low");
    expect(scale.cutoffs).toEqual({ moderate: null, high: null, extreme: null });
  });

  it("handles an empty array", () => {
    const scale = rankScale([]);
    expect(scale.rank(42)).toBe(0);
    expect(scale.band(42)).toBe("low");
    expect(scale.population).toBe(0);
  });

  it("handles duplicates in the middle", () => {
    const scale = rankScale([0, 0, 0, 1, 1, 5, 5, 10, 10, 10]);
    expect(scale.rank(0)).toBe(0);
    expect(scale.rank(1)).toBe(30);
    expect(scale.rank(5)).toBe(50);
    expect(scale.rank(10)).toBe(70);
  });

  it("cutoffs agree with rank: all null when max rank is below 75", () => {
    const values = [0, 0, 0, 1, 1, 5, 5, 10, 10, 10];
    const scale = rankScale(values);

    expect(scale.cutoffs).toEqual({ moderate: null, high: null, extreme: null });
    expect(scale.band(10)).toBe("low");
  });

  it("cutoffs mark the first value reaching each band on a uniform distribution", () => {
    const values = Array.from({ length: 100 }, (_, i) => i);
    const scale = rankScale(values);

    expect(scale.cutoffs).toEqual({ moderate: 75, high: 90, extreme: 95 });
    expect(scale.band(75)).toBe("moderate");
    expect(scale.band(74)).toBe("low");
    expect(scale.band(90)).toBe("high");
    expect(scale.band(95)).toBe("extreme");
  });
});

describe("cycleSeverity", () => {
  it.each([
    [2, 2, "minor"],
    [3, 3, "moderate"],
    [5, 10, "moderate"],
    [6, 15, "severe"],
    [10, 45, "severe"],
  ] as const)("size %d, %d edges → %s", (size, edges, expected) => {
    expect(cycleSeverity(size, edges).severity).toBe(expected);
  });

  it("computes density as edges / (size * (size - 1))", () => {
    expect(cycleSeverity(3, 6).density).toBe(1.0);
    expect(cycleSeverity(3, 3).density).toBe(0.5);
    expect(cycleSeverity(5, 10).density).toBe(0.5);
  });

  it("returns null density for a self-loop (size 1)", () => {
    expect(cycleSeverity(1, 0).density).toBeNull();
  });

  it("tracks the edge count", () => {
    expect(cycleSeverity(4, 7).edges).toBe(7);
  });
});

describe("isHub", () => {
  it("is true when both ranks are at or above 75", () => {
    expect(isHub(75, 75)).toBe(true);
    expect(isHub(90, 80)).toBe(true);
  });

  it("is false when either rank is below 75", () => {
    expect(isHub(74, 90)).toBe(false);
    expect(isHub(90, 74)).toBe(false);
    expect(isHub(50, 50)).toBe(false);
  });
});
