import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const formatRomanianDate = (value: string, withTime = false) =>
  new Intl.DateTimeFormat("ro-RO", {
    dateStyle: "long",
    ...(withTime ? { timeStyle: "short" } : {}),
    timeZone: "Europe/Bucharest",
  }).format(new Date(value));
