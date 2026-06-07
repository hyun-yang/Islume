"use client";

import { useAppStore, type Locale } from "@/stores/appStore";
import { en } from "./en";
import { ko } from "./ko";
import { ja } from "./ja";

/**
 * Lightweight UI i18n — flat key→string dictionaries per locale plus a `useT`
 * hook that reads the persisted `locale` from the app store. Deliberately not
 * a routing-based library (next-intl etc.): Islume only needs an in-place
 * en/ko/ja toggle, and the package-age gate makes adding a dep costly.
 *
 * Lookup falls back English-then-key, so a missing translation degrades to the
 * English string (or the raw key) instead of throwing — safe for incremental
 * adoption.
 */
type Dict = Record<string, string>;

const dict: Record<Locale, Dict> = { en, ko, ja };

export function useT(): (key: string) => string {
  const locale = useAppStore((s) => s.locale);
  return (key: string) => dict[locale][key] ?? dict.en[key] ?? key;
}

export function useLocale(): Locale {
  return useAppStore((s) => s.locale);
}
