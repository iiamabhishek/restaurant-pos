"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface ExpenseRow {
  id: string;
  spentOn: string;
  category: string;
  amount: string;
  note: string | null;
  paidFromCash: boolean;
  status: "PENDING" | "APPROVED" | "REJECTED";
  decisionNote: string | null;
  createdBy?: { id: string; name: string };
}
export interface PettyCashEntryRow {
  id: string;
  kind: "TOPUP" | "VOUCHER" | "ADJUSTMENT";
  delta: string;
  countedCash: string | null;
  bookBalance: string | null;
  category: string | null;
  payee: string | null;
  receiptRef: string | null;
  note: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
  expense: { id: string; status: ExpenseRow["status"]; decisionNote: string | null } | null;
}
export interface PettyCash {
  balance: string;
  entries: PettyCashEntryRow[];
}
export interface ClosingPreview {
  businessDate: string;
  openingFloat: number;
  cashSales: number;
  cashExpenses: number;
  expectedCash: number;
}
export interface ClosingRow {
  id: string;
  businessDate: string;
  expectedCash: string;
  countedCash: string;
  variance: string;
  note: string | null;
}
export interface ProfitLoss {
  orders: number;
  grossCollected: number;
  taxCollected: number;
  refunds: number;
  netSales: number;
  expenses: { category: string; amount: number }[];
  totalExpenses: number;
  payrollCost: number;
  netProfit: number;
}
export interface GstReport {
  orders: number;
  rows: { ratePercent: number; taxableValue: number; tax: number; total: number }[];
  totalTaxable: number;
  totalTax: number;
}
export interface BranchRow {
  branchId: string;
  name: string;
  orders: number;
  sales: number;
  openOrders: number;
  lowStockItems: number;
  inventoryValue: number;
}

const q = (b: string | null) => `branchId=${b}`;

export function useExpenses(branchId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ["acct", "expenses", branchId, from, to],
    queryFn: () => api.get<ExpenseRow[]>(`/accounting/expenses?${q(branchId)}&from=${from}&to=${to}`),
    enabled: !!branchId,
  });
}
export function usePendingExpenses(branchId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["acct", "expenses-pending", branchId],
    queryFn: () => api.get<ExpenseRow[]>(`/accounting/expenses/pending?${q(branchId)}`),
    enabled: !!branchId && enabled,
    refetchInterval: 30_000,
  });
}
export function useMyExpenses(branchId: string | null) {
  return useQuery({
    queryKey: ["acct", "expenses-mine", branchId],
    queryFn: () => api.get<ExpenseRow[]>(`/accounting/expenses/mine?${q(branchId)}`),
    enabled: !!branchId,
  });
}
export function usePettyCash(branchId: string | null) {
  return useQuery({
    queryKey: ["acct", "petty-cash", branchId],
    queryFn: () => api.get<PettyCash>(`/accounting/petty-cash?${q(branchId)}`),
    enabled: !!branchId,
  });
}
export function usePettyCashActions(branchId: string | null) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["acct"] });
  const url = (path: string) => `/accounting/petty-cash/${path}?${q(branchId)}`;
  return {
    topup: useMutation({
      mutationFn: (dto: { amount: number; note?: string; clientRequestId: string }) => api.post(url("topups"), dto),
      onSuccess: done,
    }),
    voucher: useMutation({
      mutationFn: (dto: {
        amount: number;
        category: string;
        payee?: string;
        receiptRef?: string;
        note?: string;
        clientRequestId: string;
      }) => api.post(url("vouchers"), dto),
      onSuccess: done,
    }),
    count: useMutation({
      mutationFn: (dto: { countedCash: number; note?: string; clientRequestId: string }) => api.post(url("counts"), dto),
      onSuccess: done,
    }),
  };
}
export function useClosingPreview(branchId: string | null, date: string, openingFloat: number) {
  return useQuery({
    queryKey: ["acct", "preview", branchId, date, openingFloat],
    queryFn: () =>
      api.get<ClosingPreview>(`/accounting/closing/preview?${q(branchId)}&date=${date}&openingFloat=${openingFloat}`),
    enabled: !!branchId,
  });
}
export function useClosings(branchId: string | null) {
  return useQuery({
    queryKey: ["acct", "closings", branchId],
    queryFn: () => api.get<ClosingRow[]>(`/accounting/closing?${q(branchId)}`),
    enabled: !!branchId,
  });
}
export interface PhoneTillRow {
  id: string;
  deviceName: string;
  businessDate: string;
  expectedCash: number;
  countedCash: number;
  variance: number;
  netSales: number;
  closedByName: string | null;
  closedAt: string;
}
/** Each phone's own day-end cash count (phone app, standalone mode). */
export function usePhoneTills(branchId: string | null) {
  return useQuery({
    queryKey: ["acct", "phone-tills", branchId],
    queryFn: () => api.get<PhoneTillRow[]>(`/mobile/standalone/till-closings?${q(branchId)}`),
    enabled: !!branchId,
  });
}
export function useProfitLoss(branchId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ["acct", "pnl", branchId, from, to],
    queryFn: () => api.get<ProfitLoss>(`/accounting/profit-loss?${q(branchId)}&from=${from}&to=${to}`),
    enabled: !!branchId,
  });
}
export function useGst(branchId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ["acct", "gst", branchId, from, to],
    queryFn: () => api.get<GstReport>(`/accounting/gst?${q(branchId)}&from=${from}&to=${to}`),
    enabled: !!branchId,
  });
}
export function useBranchOverview(from: string, to: string) {
  return useQuery({
    queryKey: ["acct", "branches", from, to],
    queryFn: () => api.get<BranchRow[]>(`/accounting/branches?from=${from}&to=${to}`),
  });
}

export function useAccountingActions(branchId: string | null) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["acct"] });
  return {
    addExpense: useMutation({
      mutationFn: (dto: {
        spentOn: string;
        category: string;
        amount: number;
        note?: string;
        paidFromCash: boolean;
        clientRequestId?: string;
      }) =>
        api.post(`/accounting/expenses?${q(branchId)}`, dto),
      onSuccess: done,
    }),
    decideExpense: useMutation({
      mutationFn: ({ id, approve, note }: { id: string; approve: boolean; note?: string }) =>
        api.post(`/accounting/expenses/${id}/${approve ? "approve" : "reject"}?${q(branchId)}`, { note }),
      onSuccess: done,
    }),
    deleteExpense: useMutation({
      mutationFn: (id: string) => api.delete(`/accounting/expenses/${id}?${q(branchId)}`),
      onSuccess: done,
    }),
    closeDay: useMutation({
      mutationFn: (dto: { businessDate: string; openingFloat: number; countedCash: number; note?: string }) =>
        api.post(`/accounting/closing?${q(branchId)}`, dto),
      onSuccess: done,
    }),
  };
}
