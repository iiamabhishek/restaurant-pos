export interface ReminderInput {
  customerName: string | null;
  phone: string | null;
  orderNumber: string;
  balance: number;
  /** Already formatted with the restaurant's currency, e.g. "₹700.00". */
  balanceText: string;
  restaurantName?: string | null;
}

export type ReminderLink =
  | { ok: true; href: string; message: string }
  | { ok: false; reason: string };

/** Digits only, 8 to 15 long (the E.164 range). Anything else cannot be a WhatsApp number. */
export function whatsappDigits(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/**
 * A wa.me link with the reminder already typed, for staff to review and send themselves. Nothing is sent
 * automatically. A missing or unusable phone number gives a reason to show instead of a dead link.
 */
export function buildReminderLink(i: ReminderInput): ReminderLink {
  if (!(i.balance > 0)) return { ok: false, reason: "Nothing is owed on this bill." };
  if (!i.phone || !i.phone.trim()) return { ok: false, reason: "This customer has no phone number saved." };
  const digits = whatsappDigits(i.phone);
  if (!digits) return { ok: false, reason: "This customer's phone number does not look valid." };
  const who = i.customerName?.trim() || "there";
  const from = i.restaurantName?.trim() ? ` at ${i.restaurantName.trim()}` : "";
  const message =
    `Hello ${who}, a friendly reminder${from}: bill #${i.orderNumber} has ${i.balanceText} still due. ` +
    `Please pay when you can. Thank you!`;
  return { ok: true, href: `https://wa.me/${digits}?text=${encodeURIComponent(message)}`, message };
}
