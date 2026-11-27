"use client";

import { createContext, useContext, useMemo } from "react";
import { createStaffFormat } from "@/lib/format";
import { useI18n } from "@/lib/i18n/context";
import { LOCALE_TAGS } from "@/lib/i18n/locales";

export const StaffCurrencyContext = createContext<string | undefined>(undefined);

export function useStaffFormat() {
  const { locale, t } = useI18n();
  const currency = useContext(StaffCurrencyContext);
  return useMemo(() => createStaffFormat(LOCALE_TAGS[locale], t, currency), [locale, t, currency]);
}

export type { StaffFormat } from "@/lib/format";
