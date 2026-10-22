export type CcBand = "low" | "moderate" | "high";
export type FanBand = "low" | "moderate" | "high" | "extreme";
export type CycleSeverityLevel = "minor" | "moderate" | "severe";

export const excessFrom = 10;
export const highFrom = 16;

export const ccBand = (cc: number): CcBand => {
  if (cc <= excessFrom) return "low";
  if (cc < highFrom) return "moderate";
  return "high";
};

export type RankScale = {
  rank: (value: number) => number;
  band: (value: number) => FanBand;
  cutoffs: { moderate: number | null; high: number | null; extreme: number | null };
  population: number;
};

const fanBand = (rank: number): FanBand => {
  if (rank < 75) return "low";
  if (rank < 90) return "moderate";
  if (rank < 95) return "high";
  return "extreme";
};

export const rankScale = (values: readonly number[]): RankScale => {
  const sorted = values.toSorted((a, b) => a - b);
  const n = sorted.length;

  const rank = (value: number): number => {
    if (n === 0) return 0;
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((sorted[mid] ?? 0) < value) lo = mid + 1;
      else hi = mid;
    }
    return Math.floor((100 * lo) / n);
  };

  const band = (value: number): FanBand => fanBand(rank(value));

  const cutoffFor = (threshold: number): number | null => sorted.find((value) => rank(value) >= threshold) ?? null;

  return {
    rank,
    band,
    cutoffs: { moderate: cutoffFor(75), high: cutoffFor(90), extreme: cutoffFor(95) },
    population: n,
  };
};

export type CycleSeverity = { severity: CycleSeverityLevel; edges: number; loops: number };

export const cycleSeverity = (size: number, edgeCount: number): CycleSeverity => ({
  severity: size <= 2 ? "minor" : size <= 5 ? "moderate" : "severe",
  edges: edgeCount,
  loops: edgeCount - size + 1,
});

export type Role = "central" | "shared" | "control" | "peripheral";

export const median = (values: readonly number[]): number => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length === 0) return 0;

  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

export const role = (fanIn: number, fanOut: number, medians: { fanIn: number; fanOut: number }): Role => {
  const many = fanIn > medians.fanIn;
  const much = fanOut > medians.fanOut;

  if (many && much) return "central";
  if (many) return "shared";
  if (much) return "control";
  return "peripheral";
};
