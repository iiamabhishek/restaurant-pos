"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type DuesStatus = "OUTSTANDING" | "UNPAID" | "PARTIAL" | "PAID";

export interface DueRow {
  orderId: string;
  orderNumber: string;
  type: string;
  createdAt: string;
  customer: { id: string; name: string | null; phone: string | null };
  total: number;
  paid: number;
  balance: number;
  status: "UNPAID" | "PARTIAL" | "PAID";
  payments: { id: string; method: string; amount: number; at: string }[];
}

export interface DuesResponse {
  rows: DueRow[];
  /** True when more bills match than `rows` holds; totals still cover every bill. */
  rowsTruncated?: boolean;
  totalCount?: number;
  totalOutstanding: number;
  customers: { customerId: string; name: string | null; phone: string | null; bills: number; owed: number; oldest: string }[];
}

export interface DuesFilters {
  status: DuesStatus;
  customerId: string;
  from: string;
  to: string;
}

export function useDues(branchId: string | null, f: DuesFilters) {
  const qs = new URLSearchParams({ branchId: branchId ?? "", status: f.status });
  if (f.customerId) qs.set("customerId", f.customerId);
  if (f.from) qs.set("from", new Date(`${f.from}T00:00:00`).toISOString());
  if (f.to) qs.set("to", new Date(`${f.to}T23:59:59.999`).toISOString());
  return useQuery({
    queryKey: ["dues", branchId, f],
    queryFn: () => api.get<DuesResponse>(`/orders/dues?${qs.toString()}`),
    enabled: !!branchId,
    // Balances change from other tills; never show a cached ledger.
    staleTime: 0,
    refetchOnMount: "always",
  });
}
