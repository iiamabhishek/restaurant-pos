export interface CartLine {
  key: string;
  menuItemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  modifierIds: string[];
  modifierLabel?: string;
  portion?: Portion;
}

export type PortionKind = "HALF" | "FULL" | "CUSTOM";

export interface Portion {
  kind: PortionKind;
  // Only for CUSTOM: staff-typed label and unit price.
  customLabel?: string;
  customPrice?: number;
}

const PORTION_LABELS: Record<PortionKind, string> = { HALF: "Half", FULL: "Full", CUSTOM: "Custom" };

/** Portion names are UI copy. Menu item names and custom portion labels come from staff. */
export function cartLineName(line: CartLine, t: (key: string) => string = (key) => key): string {
  const { name, portion } = line;
  if (!portion) return name;
  const label = portion.kind === "CUSTOM" && portion.customLabel
    ? portion.customLabel
    : t(PORTION_LABELS[portion.kind]);
  return `${name} (${label})`;
}

export function cartLineKey(menuItemId: string, modifierIds: string[], portion?: Portion): string {
  const p = portion ? `${portion.kind}:${portion.customLabel ?? ""}:${portion.customPrice ?? ""}` : "";
  return `${menuItemId}::${[...modifierIds].sort().join(",")}::${p}`;
}
