export type Category =
  | "Politică"
  | "Economie"
  | "Extern"
  | "Social"
  | "Energie"
  | "Piețe"
  | "Justiție"
  | "Securitate";

export type Horizon = "Imediat" | "1–4 săptămâni" | "1–3 luni" | "6–12 luni";

export interface Edition {
  metadata: {
    editionDate: string;
    updatedAt: string;
    timezone: "Europe/Bucharest";
    title: string;
    status: "published" | "draft" | "demo";
    primarySource: string;
    sourceCoverage: "complete" | "partial";
  };
  executiveSummary: Array<{ id: string; text: string; category: Category }>;
  importantNews: Array<{
    id: string;
    title: string;
    fact: string;
    interpretation: string;
    category: Category;
    impact: number;
    impactLabel: string;
    horizon: Horizon;
    sourceId: string;
    sourceName: string;
    sourceUrl: string;
    isSecondary: boolean;
    confidence: "confirmed";
  }>;
  romaniaAnalysis: {
    factBase: string[];
    political: string;
    economic: string;
    interpretation: string;
  };
  investmentFundSignals: Array<{
    id: string;
    label: string;
    direction: "pozitiv" | "neutru" | "negativ";
    strength: number;
    horizon: Horizon;
    rationale: string;
  }>;
  indicators: Array<{
    id: string;
    label: string;
    value: string | number | null;
    unit: string;
    referenceDate: string;
    sourceName: string;
    sourceUrl: string;
    freshness: "current" | "stale" | "unavailable";
    note?: string;
  }>;
  riskScores: Array<{
    id: string;
    label: string;
    score: number;
    trend: "în creștere" | "stabil" | "în scădere";
    description: string;
  }>;
  watchlist: Array<{
    id: string;
    title: string;
    why: string;
    trigger: string;
    status: "neconfirmat" | "contradictoriu" | "în așteptare";
    sourceUrl?: string;
  }>;
  conclusion: { title: string; body: string; actionPoints: string[] };
  sources: Array<{
    id: string;
    name: string;
    url: string;
    type: "primary" | "secondary" | "official";
    accessedAt: string;
  }>;
}

export interface ArchiveIndex {
  editions: Array<{ date: string; label: string }>;
}
