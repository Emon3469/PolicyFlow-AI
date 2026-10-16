"use client";

import { Menu, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Kbd, StatusDot } from "@/components/ui/primitives";
import { useHealth } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { CommandMenu } from "./command-menu";
import { titleFor } from "./nav";
import { Sidebar } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";

function ServerStatus() {
  const { data, error, isLoading } = useHealth();
  const kb = data?.knowledge_base.status;
  const state = error ? "offline" : isLoading || !data ? "connecting" : kb === "ready" ? "online" : kb === "error" ? "degraded" : "warming";
  const label = { offline: "Waking server", connecting: "Connecting", online: "Online", degraded: "Degraded", warming: "Warming up" }[state];
  const tone = state === "online" ? "ok" : state === "degraded" ? "danger" : "warn";
  return (
    <Link
      href="/settings"
      className="hidden h-8 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-[12px] text-muted hover:text-fg sm:flex"
    >
      <StatusDot tone={tone} pulse={state !== "online"} />
      {label}
    </Link>
  );
}

function OfflineBanner() {
  const { error, data } = useHealth();
  if (!error || data) return null;
  return (
    <div className="border-b border-border bg-warn-bg px-4 py-2 text-center text-[12.5px] text-warn-fg">
      Connecting to the PolicyFlow server… if it was idle, it can take up to a minute to wake up.
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopHidden, setDesktopHidden] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const title = titleFor(pathname);

  useEffect(() => setMobileOpen(false), [pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((value) => !value);
      } else if (event.key === "/") {
        event.preventDefault();
        router.push("/assistant");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const openCommand = useCallback(() => setCommandOpen(true), []);
  const openHelp = useCallback(() => setHelpOpen(true), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  return (
    <div className="flex h-dvh overflow-hidden">
      <div className={cn("hidden shrink-0 lg:block", desktopHidden && "lg:hidden")}>
        <Sidebar onOpenCommand={openCommand} onOpenHelp={openHelp} onClose={() => setDesktopHidden(true)} />
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={closeMobile} />
          <div className="relative h-full w-[248px] shadow-2xl animate-fade-in">
            <Sidebar onOpenCommand={openCommand} onOpenHelp={openHelp} onClose={closeMobile} onNavigate={closeMobile} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-md p-1.5 text-muted hover:bg-surface-3 hover:text-fg lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="size-4" />
            </button>
            {desktopHidden && (
              <button
                onClick={() => setDesktopHidden(false)}
                className="hidden rounded-md p-1.5 text-muted hover:bg-surface-3 hover:text-fg lg:block"
                aria-label="Show sidebar"
              >
                <PanelLeftOpen className="size-4" />
              </button>
            )}
            <h1 className="truncate text-[14px] font-medium">{title}</h1>
          </div>
          <div className="flex items-center gap-2">
            <ServerStatus />
            <ThemeToggle />
            <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-b from-[#3a3a40] to-[#141416] text-[11px] font-semibold text-white ring-1 ring-black/5 dark:from-[#f2f2f3] dark:to-[#cfcfd4] dark:text-[#111113]">
              HR
            </div>
          </div>
        </header>
        <OfflineBanner />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
      <Dialog open={helpOpen} onClose={() => setHelpOpen(false)} title="Help & shortcuts" description="Get around PolicyFlow AI faster.">
        <div className="space-y-2 text-[13px]">
          {[
            ["Open quick find", "⌘ K"],
            ["Ask the assistant", "⌘ /"],
            ["Send message", "Enter"],
            ["New line in message", "Shift + Enter"],
          ].map(([label, keys]) => (
            <div key={label} className="flex items-center justify-between rounded-lg border border-border bg-surface-2 px-3 py-2">
              <span className="text-muted">{label}</span>
              <Kbd>{keys}</Kbd>
            </div>
          ))}
          <p className="pt-2 text-[12.5px] leading-relaxed text-muted">
            The assistant answers from the private HR knowledge base first. When internal evidence is weak it searches trusted public
            sources and clearly labels the answer, so you always know where information came from.
          </p>
        </div>
      </Dialog>
    </div>
  );
}
