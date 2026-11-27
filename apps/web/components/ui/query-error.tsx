"use client";

import { type Translate, useI18n } from "@/lib/i18n/context";
import { RefreshCw } from "lucide-react";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Plain-language reason a request failed, naming a permission problem as one. */
export function describeLoadError(t: Translate, error: unknown, what: string): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return t("Your session has ended. Sign in again to load {what}.", { what });
    if (error.status === 403) return t("Your role is not allowed to see {what}. Ask an administrator to grant access.", { what });
    if (error.status >= 500) return t("The server had a problem loading {what}. Try again in a moment.", { what });
    return error.message || t("Could not load {what}.", { what });
  }
  return t("Could not reach the server to load {what}. Check the connection and try again.", { what });
}

// Shown in place of a list/grid whose request failed, so a failure is never
// mistaken for "nothing here yet". Always offers a retry.
export function QueryError({
  error,
  what,
  onRetry,
  retrying = false,
  className,
}: {
  error: unknown;
  what: string;
  onRetry: () => void;
  retrying?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-8 text-center",
        className,
      )}
    >
      <p className="max-w-sm text-sm text-foreground">{describeLoadError(t, error, what)}</p>
      <Button type="button" variant="outline" className="h-11 px-4" disabled={retrying} onClick={onRetry}>
        <RefreshCw className={cn("h-4 w-4", retrying && "animate-spin")} aria-hidden />
        {retrying ? t("Retrying…") : t("Try again")}
      </Button>
    </div>
  );
}
