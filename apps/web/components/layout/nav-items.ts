import {
  CalendarClock,
  Clock,
  Bike,
  Truck,
  Users,
  Landmark,
  BarChart3,
  Megaphone,
  Wrench,
  ChefHat,
  LayoutDashboard,
  ClipboardList,
  LayoutGrid,
  Package,
  Settings,
  ShoppingCart,
  UsersRound,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  labelKey: string;
  href: string;
  icon: LucideIcon;
  permission?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { labelKey: "nav.dashboard", href: "/dashboard", icon: LayoutDashboard, permission: "dashboard.sales.view" },
  { labelKey: "nav.pos", href: "/pos", icon: ShoppingCart, permission: "orders.create" },
  { labelKey: "nav.orders", href: "/orders", icon: ClipboardList, permission: "orders.create" },
  { labelKey: "nav.tables", href: "/tables", icon: LayoutGrid, permission: "tables.view" },
  {
    labelKey: "nav.reservations",
    href: "/reservations",
    icon: CalendarClock,
    permission: "reservations.manage",
  },
  { labelKey: "nav.menu", href: "/menu", icon: UtensilsCrossed, permission: "menu.view" },
  { labelKey: "nav.kds", href: "/kds", icon: ChefHat, permission: "kds.manage" },
  { labelKey: "nav.customers", href: "/customers", icon: UsersRound, permission: "customers.manage" },
  { labelKey: "nav.inventory", href: "/inventory", icon: Package, permission: "journal.manage" },
  { labelKey: "nav.myDeliveries", href: "/my-deliveries", icon: Bike, permission: "delivery.rider" },
  { labelKey: "nav.delivery", href: "/delivery", icon: Truck, permission: "delivery.manage" },
  { labelKey: "nav.team", href: "/team", icon: Users, permission: "staff.manage" },
  { labelKey: "nav.accounting", href: "/accounting", icon: Landmark, permission: "expenses.submit" },
  { labelKey: "nav.reports", href: "/reports", icon: BarChart3, permission: "reports.access" },
  { labelKey: "nav.marketing", href: "/marketing", icon: Megaphone, permission: "marketing.manage" },
  { labelKey: "nav.operations", href: "/operations", icon: Wrench, permission: "operations.manage" },
  { labelKey: "nav.attendance", href: "/attendance", icon: Clock },
  { labelKey: "nav.settings", href: "/settings", icon: Settings, permission: "settings.manage" },
];

export interface NavGroup {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  hrefs: string[];
}

/** Sidebar sections. Dashboard stays on top by itself; each group opens and closes from its heading. */
export const NAV_GROUPS: NavGroup[] = [
  { id: "sales", labelKey: "nav.group.sales", icon: ShoppingCart, hrefs: ["/pos", "/orders", "/tables", "/reservations"] },
  { id: "kitchen", labelKey: "nav.group.kitchen", icon: ChefHat, hrefs: ["/menu", "/kds", "/inventory"] },
  { id: "people", labelKey: "nav.group.people", icon: UsersRound, hrefs: ["/customers", "/delivery", "/my-deliveries"] },
  { id: "business", labelKey: "nav.group.business", icon: Landmark, hrefs: ["/accounting", "/reports", "/marketing"] },
  { id: "admin", labelKey: "nav.group.admin", icon: Settings, hrefs: ["/team", "/attendance", "/operations", "/settings"] },
];
