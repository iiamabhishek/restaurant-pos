"use client";

import { useI18n } from "@/lib/i18n/context";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useBranch } from "@/hooks/use-branch";
import { useFloors } from "@/hooks/use-tables";
import { toast } from "@/lib/toast";

// One card per table: the QR code to print, and the link to write onto the table's NFC card. The QR and the
// NFC card open the SAME link, so a guest who cannot read NFC can scan, and the reverse.
export default function TableCardsPage() {
  const { t: translate } = useI18n();
  const { branchId } = useBranch();
  const { data: floors, isLoading } = useFloors(branchId, true);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const tables = (floors ?? []).flatMap((f) => f.tables.map((t) => ({ ...t, floorName: f.name })));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{translate("Table cards")}</h1>
          <p className="text-sm text-muted-foreground">{translate("QR code and NFC link for each table")}</p>
        </div>
        <Button onClick={() => window.print()}>{translate("Print")}</Button>
      </div>
      <Card className="p-4 text-sm text-muted-foreground print:hidden">
        <p className="font-medium text-foreground">{translate("Writing the NFC cards")}</p>
        <ol className="mt-1 list-decimal space-y-1 pl-5">
          <li>{translate("On an Android phone with NFC, open an NFC tag app (for example “NFC Tools”) and choose")} <b>{translate("Write → Add a record → URL / URI")}</b>.</li>
          <li>{translate("Paste the table’s link from below, then hold the card to the phone. One link per card.")}</li>
          <li>{translate("Test it: tap the card with another phone. It should open this table’s menu.")}</li>
        </ol>
        <p className="mt-2">{translate("The link contains a private token for the table, not the table number. If a card is lost or copied, use “New QR code” on the table (Tables > Edit floor plan) and rewrite that card. Card types, chips and any read-range or phone-compatibility claims have not been checked on your actual cards.")}</p>
      </Card>
      {isLoading ? <p className="text-sm text-muted-foreground">{translate("Loading…")}</p> : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3">
          {tables.map((t) => {
            const url = t.qrToken ? `${origin}/order/${t.qrToken}` : null;
            return (
              <li key={t.id} className="break-inside-avoid">
                <Card className="flex flex-col items-center gap-3 p-4 text-center">
                  <p className="text-xl font-semibold">{translate("Table {number}", { number: t.number })}</p>
                  <p className="text-xs text-muted-foreground">{t.floorName}</p>
                  {url ? (
                    <>
                      <div className="rounded-xl bg-white p-2"><QRCodeSVG value={url} size={150} level="M" /></div>
                      <p className="text-sm">{translate("Scan or tap to order")}</p>
                      <div className="flex w-full items-center gap-1 print:hidden">
                        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label={translate("Link for table {number}", { number: t.number })} className="min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2 py-1 text-xs" />
                        <Button size="xs" variant="outline" onClick={() => { void navigator.clipboard?.writeText(url); toast.success(translate("Link copied")); }}>{translate("Copy")}</Button>
                      </div>
                    </>
                  ) : <p className="text-xs text-destructive">{translate("No QR code yet. Open the table in the editor and create one.")}</p>}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
