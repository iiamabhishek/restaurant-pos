"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n/context";
import { usePathname } from "next/navigation";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { useNavBadges } from "@/hooks/use-nav-badges";
import { useBranch } from "@/hooks/use-branch";
import { useSettings } from "@/hooks/use-settings";
import { cn } from "@/lib/utils";
import { NavDot } from "@/components/layout/nav-dot";

interface SettingsTab {
  labelKey: string;
  href: string;
  /** Omit to show the tab to anyone who can reach /settings at all. */
  permission?: string;
  /** Only shown for branches in this country (ISO code). */
  country?: string;
}

const TABS: SettingsTab[] = [
  { labelKey: "settings.tab.general", href: "/settings" },
  { labelKey: "settings.tab.staff", href: "/settings/staff", permission: "users.manage" },
  { labelKey: "settings.tab.roles", href: "/settings/roles", permission: "roles.manage" },
  { labelKey: "settings.tab.audit", href: "/settings/audit-log", permission: "audit_log.view" },
  { labelKey: "settings.tab.backup", href: "/settings/backup", permission: "backup.manage" },
  { labelKey: "settings.tab.updates", href: "/settings/updates", permission: "system.update" },
  { labelKey: "settings.tab.sync", href: "/settings/sync", permission: "settings.manage" },
  { labelKey: "settings.tab.phones", href: "/settings/devices", permission: "users.manage" },
  { labelKey: "settings.tab.customerScreen", href: "/settings/customer-screen", permission: "settings.manage" },
  { labelKey: "settings.tab.buzzers", href: "/settings/buzzers", permission: "settings.manage" },
  { labelKey: "settings.tab.simulator", href: "/simulator", permission: "settings.manage" },
  { labelKey: "settings.tab.integrations", href: "/settings/integrations", permission: "settings.manage" },
  { labelKey: "settings.tab.payments", href: "/settings/payment-gateways", permission: "settings.manage" },
  { labelKey: "settings.tab.apiKeys", href: "/settings/api-keys" },
  { labelKey: "settings.tab.security", href: "/settings/security" },
  { labelKey: "settings.tab.webhooks", href: "/settings/webhooks", permission: "settings.manage" },
  { labelKey: "settings.tab.verifactu", href: "/settings/verifactu", permission: "settings.manage", country: "ES" },
];

export function SettingsTabs() {
  const pathname = usePathname();
  const { t, locale } = useI18n();
  const activeLink = useRef<HTMLAnchorElement>(null);
  const { data } = useCurrentUser();
  const user = data?.user;
  const badges = useNavBadges();
  const { branchId } = useBranch();
  const branchCountry = useSettings(branchId).data?.branch.country;

  const visibleTabs = TABS.filter(
    (tab) =>
      (!tab.permission || hasPermission(user, tab.permission)) &&
      (!tab.country || branchCountry === tab.country),
  );

  useEffect(() => {
    const link = activeLink.current;
    const nav = link?.parentElement;
    if (!link || !nav) return;
    const left = link.getBoundingClientRect().left - nav.getBoundingClientRect().left;
    if (left < 0) nav.scrollLeft += left;
    else if (left + link.offsetWidth > nav.clientWidth) nav.scrollLeft += left + link.offsetWidth - nav.clientWidth;
  }, [pathname, locale, visibleTabs.length]);

  return (
    <nav aria-label={t("nav.settings")} className="flex min-w-0 gap-1 overflow-x-auto border-b border-border">
      {visibleTabs.map((tab) => {
        const isActive =
          tab.href === "/settings" ? pathname === "/settings" : pathname?.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            ref={isActive ? activeLink : undefined}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 pb-3 text-sm font-medium transition-colors",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(tab.labelKey)}
            {badges.settingsTabs[tab.href] ? <NavDot className="ml-0" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
