"use client";

import { useStaffFormat, type StaffFormat } from "@/hooks/use-staff-format";
import { type Translate, useI18n } from "@/lib/i18n/context";
import { useMemo } from "react";
import { type SearchOption, SearchSelect } from "@/components/ui/search-select";
import type { StockItem } from "@/hooks/use-stock-journal";

const KIND_LABEL = { PURCHASED: "Raw materials", PREPARED: "Finished products" } as const;
/** Menu items without a stock item yet are offered with this id prefix; choosing one asks to link it first. */
export const MENU_PREFIX = "menu:";

/** Stock items as searchable picker options: raw materials first, then finished products, with stock on hand beside each name. */
export function stockItemOptions(t: Translate, fmt: StaffFormat, items: StockItem[]): SearchOption[] {
  return [...items]
    .sort((a, b) => {
      const ma = a.id.startsWith(MENU_PREFIX);
      const mb = b.id.startsWith(MENU_PREFIX);
      if (ma !== mb) return ma ? 1 : -1;
      return a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "PURCHASED" ? -1 : 1;
    })
    .map((i) => i.id.startsWith(MENU_PREFIX)
      ? { value: i.id, label: i.name, hint: i.category ?? undefined, aside: t("menu item"), group: t("Menu items (not in stock yet)") }
      : {
      value: i.id,
      label: i.name,
      hint: i.category ?? undefined,
      aside: `${fmt.quantity(i.currentStock)} ${fmt.unit(i.unit)}`,
      warn: Number(i.currentStock) <= 0,
      group: t(KIND_LABEL[i.kind]),
    });
}

/**
 * Searchable stock-item picker. Click shows every item; type to narrow by name or category.
 * Shows what is in stock beside each name so the cook picks the right one.
 */
export function ItemCombobox({
  items,
  value,
  onChange,
  label,
  invalid,
  describedBy,
  autoFocus,
  id,
  placeholder: providedPlaceholder,
}: {
  items: StockItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
  id?: string;
  placeholder?: string;
}) {
  const { t } = useI18n();
  const fmt = useStaffFormat();
  const placeholder = providedPlaceholder ?? t("Search items…");
  const options = useMemo(() => stockItemOptions(t, fmt, items), [items, t, fmt]);
  return (
    <SearchSelect
      id={id}
      options={options}
      value={value}
      onChange={onChange}
      aria-label={label}
      aria-describedby={describedBy}
      invalid={invalid}
      autoFocus={autoFocus}
      placeholder={placeholder}
      emptyText={t("No item matches")}
    />
  );
}
