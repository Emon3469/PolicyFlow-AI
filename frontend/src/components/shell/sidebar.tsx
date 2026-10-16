"use client";

import { ChevronDown, ChevronRight, CircleHelp, PanelLeftClose, Search, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Kbd } from "@/components/ui/primitives";
import { LogoMark } from "@/components/ui/logo";
import { useHealth } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { EXPLORE_NAV, SETTINGS_NAV, WORKSPACE_NAV, type NavItem } from "./nav";

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "group flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors",
        active
          ? "bg-surface-3 font-medium text-fg shadow-[inset_0_0_0_1px_var(--border)]"
          : "text-muted hover:bg-surface-3/70 hover:text-fg",
      )}
    >
      <Icon className={cn("size-4", active ? "text-fg" : "text-subtle group-hover:text-muted")} />
      {item.label}
    </Link>
  );
}

function Section({ label, items, onNavigate }: { label: string; items: NavItem[]; onNavigate?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="px-3">
      <button
        onClick={() => setOpen((value) => !value)}
        className="mb-1 flex items-center gap-1 px-2.5 py-1 text-[12px] font-medium text-subtle hover:text-muted"
      >
        {label}
        <ChevronDown className={cn("size-3 transition-transform", !open && "-rotate-90")} />
      </button>
      {open && (
        <nav className="space-y-0.5">
          {items.map((item) => (
            <NavLink key={item.href} item={item} onNavigate={onNavigate} />
          ))}
        </nav>
      )}
    </div>
  );
}

function HealthCard() {
  const { data, error } = useHealth();
  const status = error ? "offline" : data?.knowledge_base.status ?? "starting";
  const healthyProviders = data?.providers.filter((p) => p.configured && p.healthy).length ?? 0;
  const copy =
    status === "ready"
      ? {
          title: "Your knowledge base is ready.",
          body: `${data?.knowledge_base.vectors ?? 0} chunks indexed · ${healthyProviders} model provider${healthyProviders === 1 ? "" : "s"} online. Answers stay grounded in company policy.`,
        }
      : status === "offline"
        ? { title: "Connecting to the server…", body: "Free hosting may take up to a minute to wake up. We'll keep trying." }
        : status === "error"
          ? { title: "Knowledge base needs attention.", body: data?.knowledge_base.detail || "Check the server configuration." }
          : { title: "Preparing knowledge base…", body: data?.knowledge_base.detail || "Loading the embedding model and index." };
  const fill = status === "ready" ? "100%" : status === "error" || status === "offline" ? "18%" : "55%";

  return (
    <div className="card glow-tl relative overflow-hidden p-3.5">
      <div className="absolute -top-px left-5 right-5 h-px bg-gradient-to-r from-transparent via-c-amber/60 to-transparent" />
      <p className="text-[13px] font-medium">{copy.title}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">{copy.body}</p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-c-faint">
        <div
          className="h-full rounded-full bg-gradient-to-r from-c-blue/40 via-c-blue to-[#2f6597] transition-all duration-700"
          style={{ width: fill }}
        />
      </div>
      <Link href="/settings" className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-ok-fg hover:underline">
        View system status <ChevronRight className="size-3" />
      </Link>
    </div>
  );
}

export function Sidebar({
  onOpenCommand,
  onOpenHelp,
  onClose,
  onNavigate,
}: {
  onOpenCommand: () => void;
  onOpenHelp: () => void;
  onClose: () => void;
  onNavigate?: () => void;
}) {
  return (
    <aside className="flex h-full w-[248px] flex-col border-r border-border bg-surface">
      <div className="flex h-14 items-center justify-between gap-2 px-4">
        <Link href="/" onClick={onNavigate} className="flex min-w-0 items-center gap-2.5">
          <LogoMark />
          <span className="truncate text-[14px] font-semibold tracking-tight">PolicyFlow AI</span>
        </Link>
        <button
          onClick={onClose}
          className="rounded-md p-1.5 text-subtle hover:bg-surface-3 hover:text-fg"
          aria-label="Hide sidebar"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>

      <div className="flex gap-2 px-3 pb-3">
        <button
          onClick={onOpenCommand}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 text-[12.5px] text-muted hover:text-fg"
        >
          <Search className="size-3.5" />
          <span className="flex-1 truncate text-left whitespace-nowrap">Quick find…</span>
          <Kbd>⌘ K</Kbd>
        </button>
        <Link
          href="/assistant"
          onClick={onNavigate}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2 text-muted hover:text-fg"
          aria-label="Ask the assistant"
        >
          <Sparkles className="size-3.5" />
          <Kbd>⌘ /</Kbd>
        </Link>
      </div>

      <div className="h-px bg-border" />

      <div className="flex-1 space-y-5 overflow-y-auto py-4">
        <Section label="Workspace" items={WORKSPACE_NAV} onNavigate={onNavigate} />
        <Section label="Explore" items={EXPLORE_NAV} onNavigate={onNavigate} />
      </div>

      <div className="px-3 pb-3">
        <HealthCard />
      </div>

      <div className="h-px bg-border" />
      <div className="space-y-0.5 p-3">
        <NavLink item={SETTINGS_NAV} onNavigate={onNavigate} />
        <button
          onClick={onOpenHelp}
          className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-muted hover:bg-surface-3/70 hover:text-fg"
        >
          <CircleHelp className="size-4 text-subtle" />
          Help & Shortcuts
        </button>
      </div>
    </aside>
  );
}
