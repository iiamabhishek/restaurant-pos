"use client";

import { useI18n } from "@/lib/i18n/context";
import { Bluetooth } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useBranch } from "@/hooks/use-branch";
import { usePrintTestSlip } from "@/hooks/use-print";
import { canPrintOnDevice, chooseBtPrinter, saveBtPrinter, savedBtPrinter } from "@/lib/device-print";
import { toast } from "@/lib/toast";

const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  window.addEventListener("orderrestro:printer", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("orderrestro:printer", cb);
  };
};
const read = () => window.localStorage.getItem("orderrestro.btPrinter") ?? "";

/**
 * Settings > Printer, on a phone running the OrderRestro app: choose the paired
 * Bluetooth printer this phone prints bills and kitchen tickets on. Hidden in a
 * browser, where the printer attached to the restaurant computer is used.
 */
export function BluetoothPrinterCard() {
  const { t } = useI18n();
  const raw = useSyncExternalStore(subscribe, read, () => "");
  const { branchId } = useBranch();
  const test = usePrintTestSlip(branchId);
  const [note, setNote] = useState<string | null>(null);
  if (!canPrintOnDevice()) return null;
  const printer = raw ? savedBtPrinter() : null;

  const choose = async () => {
    const p = await chooseBtPrinter();
    if (p) window.dispatchEvent(new Event("orderrestro:printer"));
  };

  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Bluetooth className="h-[18px] w-[18px] text-muted-foreground" aria-hidden />
        <h2 className="text-[18px] font-medium text-foreground">{t("Bluetooth printer (this phone)")}</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        {t("Print bills and kitchen tickets from this phone on a 58 mm or 80 mm Bluetooth thermal printer. You can also use")} <strong>{t("Print bill")}</strong> {t("to open the phone's print dialog and save a PDF or use any printer service installed on the phone.")}
      </p>
      <p className="text-sm text-foreground">
        {printer ? (
          <>
            {t("Printer:")} <strong>{printer.name}</strong>
          </>
        ) : (
          t("No printer chosen yet.")
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void choose()}>
          {printer ? t("Change printer") : t("Choose printer")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!printer || test.isPending}
          onClick={() =>
            test.mutate(undefined, {
              onSuccess: () => setNote(t("Test slip sent.")),
              onError: (e) => {
                setNote(null);
                toast.error(e instanceof Error ? e.message : t("Could not print the test slip"));
              },
            })
          }
        >
          {test.isPending ? t("Printing…") : t("Print test slip")}
        </Button>
        {printer && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              saveBtPrinter(null);
              setNote(null);
              window.dispatchEvent(new Event("orderrestro:printer"));
            }}
          >
            {t("Forget")}
          </Button>
        )}
      </div>
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
    </Card>
  );
}
