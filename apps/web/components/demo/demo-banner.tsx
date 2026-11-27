"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { useDemoInfo } from "@/hooks/use-demo";

// Only the public demo server shows this. Visitors are told plainly that nothing here is real and when it resets.
export function DemoBanner() {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { data } = useDemoInfo();
  if (!data?.demo) return null;
  const at = data.nextResetAt ? new Date(data.nextResetAt).toLocaleTimeString(fmt.localeTag, { hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 bg-primary px-3 py-1.5 text-center text-xs font-medium text-primary-foreground">
      <span>{t("Live demo: sample data only, nothing is real.")}</span>
      <span className="opacity-90">
        {at
          ? t("Everything resets every {hours} hours (next about {time}). Some admin features are switched off.", { hours: data.resetEveryHours ?? "", time: at })
          : t("Everything resets every {hours} hours. Some admin features are switched off.", { hours: data.resetEveryHours ?? "" })}
      </span>
      <a href="https://orderrestro.nodedr.com/" className="underline">{t("Get OrderRestro")}</a>
    </div>
  );
}
