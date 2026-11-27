// Ported from nodedr-pos's frontend/lib/print.ts: loads the backend's
// self-printing receipt HTML into a hidden same-page iframe rather than a
// new tab, so there's no blank/finished tab left for the cashier to notice
// and close. The OS print dialog still opens exactly as it would for any
// other page (any printer, or "Save as PDF").
import type { Translate } from "@/lib/i18n/context";
import { canPrintOnDevice, printHtmlOnDevice } from "@/lib/device-print";
import { toast } from "@/lib/toast";

let printFrame: HTMLIFrameElement | null = null;

function getPrintFrame(): HTMLIFrameElement {
  if (printFrame) return printFrame;
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  // Positioned far off-screen rather than display:none/width:0 — a 0-width
  // frame forces the browser to lay out the receipt at 0px before printing,
  // clipping the right-aligned amount columns. A real box lets it lay out
  // normally; the huge negative offset keeps it invisible without affecting
  // page layout.
  frame.style.position = "fixed";
  frame.style.top = "-10000px";
  frame.style.left = "-10000px";
  frame.style.width = "380px";
  frame.style.height = "600px";
  frame.style.border = "none";
  document.body.appendChild(frame);
  printFrame = frame;
  return frame;
}

/** Bill figures the cashier has typed but not yet saved (see receipt route). */
export type BillQuery = Record<string, string | number | undefined>;

export function billQueryString(adj: BillQuery = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(adj)) {
    if (v !== undefined && v !== "" && v !== 0) q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `&${s}` : "";
}

/** In the phone app: fetch the page and hand it to Android's print dialog (Save as PDF or any printer). */
function printPageOnDevice(t: Translate, url: string, name: string) {
  void fetch(url, { credentials: "include" })
    .then((r) => {
      if (!r.ok) throw new Error(t("Could not load {document} ({status})", { document: name, status: r.status }));
      return r.text();
    })
    .then((html) => printHtmlOnDevice(t, html, name))
    .catch((e: unknown) => toast.error(e instanceof Error ? e.message : t("Could not open the print dialog")));
}

/** Browser print of the bill (open order) or receipt (paid order). Read-only. */
export function openReceiptPrint(t: Translate, orderId: string, branchId: string, adj: BillQuery = {}) {
  if (canPrintOnDevice()) {
    printPageOnDevice(t, `/api/v1/orders/${orderId}/receipt?branchId=${branchId}${billQueryString(adj)}`, t("Bill"));
    return;
  }
  const frame = getPrintFrame();
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) return;
    try {
      win.focus();
      win.print();
    } catch {
      win.postMessage("print", "*");
    }
  };
  // Force a reload even if printing the same order twice in a row.
  frame.src = `/api/v1/orders/${orderId}/receipt?branchId=${branchId}${billQueryString(adj)}&t=${Date.now()}`;
}

export function openKotPrint(t: Translate, orderId: string, branchId: string) {
  if (canPrintOnDevice()) {
    printPageOnDevice(t, `/api/v1/orders/${orderId}/kot?branchId=${branchId}`, t("Kitchen ticket"));
    return;
  }
  const frame = getPrintFrame();
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) return;
    try {
      win.focus();
      win.print();
    } catch {
      win.postMessage("print", "*");
    }
  };
  frame.src = `/api/v1/orders/${orderId}/kot?branchId=${branchId}&t=${Date.now()}`;
}
