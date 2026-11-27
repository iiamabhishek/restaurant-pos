import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const expenseSchema = z.object({
  spentOn: isoDate,
  category: z.string().trim().min(1).max(60),
  amount: z.coerce.number().positive(),
  note: z.string().max(300).optional(),
  paidFromCash: z.boolean().default(false),
  // One per attempt: a retry or double tap with the same key returns the first expense instead of adding another.
  clientRequestId: z.string().min(8).max(64).optional(),
});
export type ExpenseDto = z.infer<typeof expenseSchema>;

export const cashClosingSchema = z.object({
  businessDate: isoDate,
  openingFloat: z.coerce.number().min(0).default(0),
  countedCash: z.coerce.number().min(0),
  note: z.string().max(300).optional(),
});
export type CashClosingDto = z.infer<typeof cashClosingSchema>;

export const expenseDecisionSchema = z.object({
  // Why it was rejected (required for a rejection) or any remark on an approval.
  note: z.string().trim().max(300).optional(),
});
export type ExpenseDecisionDto = z.infer<typeof expenseDecisionSchema>;

const twoDecimals = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const rupees = z.coerce.number().positive().max(10_000_000).refine(twoDecimals, "At most 2 decimals");

export const pettyCashTopupSchema = z.object({
  amount: rupees,
  note: z.string().trim().max(300).optional(),
  clientRequestId: z.string().min(8).max(64).optional(),
});
export type PettyCashTopupDto = z.infer<typeof pettyCashTopupSchema>;

export const pettyCashVoucherSchema = z.object({
  amount: rupees,
  category: z.string().trim().min(1).max(60),
  payee: z.string().trim().max(120).optional(),
  receiptRef: z.string().trim().max(60).optional(),
  note: z.string().trim().max(300).optional(),
  clientRequestId: z.string().min(8).max(64).optional(),
});
export type PettyCashVoucherDto = z.infer<typeof pettyCashVoucherSchema>;

export const pettyCashCountSchema = z.object({
  countedCash: z.coerce.number().min(0).max(10_000_000).refine(twoDecimals, "At most 2 decimals"),
  note: z.string().trim().max(300).optional(),
  clientRequestId: z.string().min(8).max(64).optional(),
});
export type PettyCashCountDto = z.infer<typeof pettyCashCountSchema>;
