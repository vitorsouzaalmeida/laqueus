export type CcBand = "low" | "moderate" | "high";
export type FanBand = "low" | "moderate" | "high" | "extreme";
export type CycleSeverityLevel = "minor" | "moderate" | "severe";

export const ccBand = (cc: number): CcBand => {
  if (cc <= 10) return "low";
  if (cc <= 15) return "moderate";
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

export type CycleSeverity = { severity: CycleSeverityLevel; edges: number; density: number | null };

export const cycleSeverity = (size: number, edgeCount: number): CycleSeverity => {
  const severity: CycleSeverityLevel = size <= 2 ? "minor" : size <= 5 ? "moderate" : "severe";
  const maxEdges = size * (size - 1);
  const density = maxEdges > 0 ? Math.round((edgeCount / maxEdges) * 100) / 100 : null;
  return { severity, edges: edgeCount, density };
};

export const isHub = (fanInRank: number, fanOutRank: number): boolean => fanInRank >= 75 && fanOutRank >= 75;
