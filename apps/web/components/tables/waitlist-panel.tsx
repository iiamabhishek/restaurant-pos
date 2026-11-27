"use client";

import { useI18n } from "@/lib/i18n/context";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useCancelWaitlistEntry,
  useCreateWaitlistEntry,
  useSeatWaitlistEntry,
  useWaitlist,
} from "@/hooks/use-waitlist";
import type { RestaurantTable } from "@/hooks/use-tables";
import { ApiError } from "@/lib/api";

function AddWaitlistDialog({ branchId }: { branchId: string | null }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [partySize, setPartySize] = useState("2");
  const [quotedWaitMinutes, setQuotedWaitMinutes] = useState("15");
  const createEntry = useCreateWaitlistEntry(branchId);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createEntry.mutate(
      {
        customerName,
        phone: phone || undefined,
        partySize: Number(partySize),
        quotedWaitMinutes: quotedWaitMinutes ? Number(quotedWaitMinutes) : undefined,
      },
      {
        onSuccess: () => {
          toast.success(t("{customerName} added to waitlist", { customerName }));
          setOpen(false);
          setCustomerName("");
          setPhone("");
          setPartySize("2");
          setQuotedWaitMinutes("15");
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : t("Could not add")),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline">{t("Add to waitlist")}</Button>} />
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("Add to waitlist")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="w-name">{t("Name")}</Label>
            <Input
              id="w-name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="w-party">{t("Party size")}</Label>
              <Input
                id="w-party"
                type="number"
                min="1"
                value={partySize}
                onChange={(e) => setPartySize(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="w-wait">{t("Quoted wait (min)")}</Label>
              <Input
                id="w-wait"
                type="number"
                min="0"
                value={quotedWaitMinutes}
                onChange={(e) => setQuotedWaitMinutes(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="w-phone">{t("Phone")}</Label>
            <Input id="w-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={createEntry.isPending}>
              {createEntry.isPending ? t("Adding…") : t("Add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WaitlistPanel({
  branchId,
  availableTables,
}: {
  branchId: string | null;
  availableTables: RestaurantTable[];
}) {
  const { t: translate } = useI18n();
  const { data: entries, isLoading } = useWaitlist(branchId);
  const seat = useSeatWaitlistEntry(branchId);
  const cancel = useCancelWaitlistEntry(branchId);

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[18px] font-medium text-foreground">{translate("Waitlist")}</h2>
        <AddWaitlistDialog branchId={branchId} />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{translate("Loading…")}</p>
      ) : entries && entries.length > 0 ? (
        <div className="flex flex-col divide-y divide-border">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground">{entry.customerName}</span>
                <span className="text-xs text-muted-foreground">{translate("{partySize} guests", { partySize: entry.partySize })}{entry.quotedWaitMinutes ? translate(" · ~{quotedWaitMinutes} min", { quotedWaitMinutes: entry.quotedWaitMinutes }) : ""}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-accent"
                    disabled={availableTables.length === 0}
                  >
                    {translate("Seat")}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {availableTables.map((t) => (
                      <DropdownMenuItem
                        key={t.id}
                        onClick={() => seat.mutate({ id: entry.id, tableId: t.id })}
                      >
                        {t.name ?? translate("Table {number}", { number: t.number })}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => cancel.mutate(entry.id)}
                >
                  {translate("Remove")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="py-4 text-sm text-muted-foreground">{translate("No one waiting.")}</p>
      )}
    </Card>
  );
}
