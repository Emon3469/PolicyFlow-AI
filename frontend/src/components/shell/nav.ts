import { Activity, BarChart3, FileText, GitBranch, LayoutGrid, MessageSquare, Settings, type LucideIcon } from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; description: string };

export const WORKSPACE_NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutGrid, description: "Assistant health at a glance" },
  { href: "/assistant", label: "Assistant", icon: MessageSquare, description: "Ask HR policy questions" },
  { href: "/knowledge", label: "Knowledge Base", icon: FileText, description: "Manage indexed HR documents" },
  { href: "/activity", label: "Audit Log", icon: Activity, description: "Every question, answer and trace" },
];

export const EXPLORE_NAV: NavItem[] = [
  { href: "/insights", label: "Insights", icon: BarChart3, description: "Usage, sources and quality" },
  { href: "/workflow", label: "Workflow", icon: GitBranch, description: "How the agent decides" },
];

export const SETTINGS_NAV: NavItem = {
  href: "/settings",
  label: "Settings",
  icon: Settings,
  description: "System status, appearance and admin access",
};

export const ALL_NAV = [...WORKSPACE_NAV, ...EXPLORE_NAV, SETTINGS_NAV];

export function titleFor(pathname: string) {
  const match = ALL_NAV.find((item) => (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)));
  return match?.label ?? "PolicyFlow AI";
}
