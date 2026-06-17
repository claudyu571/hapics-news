import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Edition } from "../types/edition";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Constructing an Intl.DateTimeFormat is relatively expensive, and
// formatRomanianDate is called many times per render. Build the two
// variants once at module load and reuse them. Output is unchanged.
const dateFormatters: Record<"date" | "dateTime", Intl.DateTimeFormat> = {
  date: new Intl.DateTimeFormat("ro-RO", {
    dateStyle: "long",
    timeZone: "Europe/Bucharest",
  }),
  dateTime: new Intl.DateTimeFormat("ro-RO", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Bucharest",
  }),
};

export const formatRomanianDate = (value: string, withTime = false) =>
  dateFormatters[withTime ? "dateTime" : "date"].format(new Date(value));

// Format an indicator value the Romanian way (decimal comma, period grouping):
// 30536.43 -> "30.536,43", 5.2328 -> "5,2328". Strings pass through (already
// formatted), null renders as an em dash. Preserves the value's own precision.
export const formatRomanianNumber = (value: string | number | null) => {
  if (value === null) return "—";
  if (typeof value === "string") return value;
  const decimals = (value.toString().split(".")[1] ?? "").length;
  return new Intl.NumberFormat("ro-RO", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
};

const WORDS_PER_MINUTE = 180; // conservative rate for dense Romanian prose

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export function readingTimeMinutes(edition: Edition): number {
  let words = 0;
  for (const item of edition.executiveSummary) words += countWords(item.text);
  for (const item of edition.importantNews) {
    words += countWords(item.fact) + countWords(item.interpretation);
  }
  const { political, economic, interpretation, factBase } = edition.romaniaAnalysis;
  words += countWords(political) + countWords(economic) + countWords(interpretation);
  for (const fact of factBase) words += countWords(fact);
  words += countWords(edition.conclusion.body);
  for (const point of edition.conclusion.actionPoints) words += countWords(point);

  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}
