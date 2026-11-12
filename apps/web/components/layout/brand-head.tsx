"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";

// Browser-tab branding from Settings → General, same source as the login
// screen and sidebar (public /v1/public/branding). Rewrites the title and
// the icon <link>s the build already emitted (app/icon.png + layout
// metadata) instead of server-side generateMetadata: ~50 pages are
// statically prerendered, so server metadata would only refresh on a
// rebuild, not when the operator changes their logo/name. No-op (product
// defaults stay) while unset, before the fetch resolves, or if it fails.
export function BrandHead() {
  useEffect(() => {
    let cancelled = false;
    api.get<{ name: string | null; logoUrl: string | null }>("/public/branding")
      .then((b) => {
        if (cancelled) return;
        if (b.name) document.title = b.name;
        if (b.logoUrl) {
          // Covers rel="icon", rel="apple-touch-icon", and the shortcut form.
          document
            .querySelectorAll<HTMLLinkElement>('link[rel*="icon"]')
            .forEach((link) => {
              link.href = b.logoUrl as string;
            });
        }
      })
      .catch(() => {
        // Decorative — the product title/favicon are already in the head.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
