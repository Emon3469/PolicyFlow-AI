"use client";

import { Command } from "cmdk";
import { CornerDownLeft, Moon, Search, Sparkles, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ALL_NAV } from "./nav";

const SUGGESTED = [
  "How many annual leave days do employees receive?",
  "What is the remote work policy?",
  "How do I report a payroll discrepancy?",
];

export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onOpenChange(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open || typeof document === "undefined") return null;

  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };
  const ask = (text: string) => run(() => router.push(`/assistant?q=${encodeURIComponent(text)}`));

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[14vh]">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => onOpenChange(false)} />
      <Command
        label="Quick find"
        className="card relative w-full max-w-lg overflow-hidden shadow-2xl animate-fade-in"
        loop
      >
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="size-4 text-subtle" />
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Search pages or ask an HR question…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
          />
        </div>
        <Command.List className="max-h-[360px] overflow-y-auto p-2 text-[13px]">
          <Command.Empty className="px-3 py-6 text-center text-muted">No matches.</Command.Empty>
          {query.trim().length > 2 && (
            <Command.Group heading="Assistant" className="cmdk-group">
              <Command.Item value={`ask ${query}`} onSelect={() => ask(query.trim())} className="cmdk-item">
                <Sparkles className="size-4 text-c-blue" />
                <span className="flex-1 truncate">Ask “{query.trim()}”</span>
                <CornerDownLeft className="size-3.5 text-subtle" />
              </Command.Item>
            </Command.Group>
          )}
          <Command.Group heading="Pages" className="cmdk-group">
            {ALL_NAV.map((item) => (
              <Command.Item
                key={item.href}
                value={`${item.label} ${item.description}`}
                onSelect={() => run(() => router.push(item.href))}
                className="cmdk-item"
              >
                <item.icon className="size-4 text-subtle" />
                <span>{item.label}</span>
                <span className="ml-auto truncate text-[12px] text-subtle">{item.description}</span>
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="Try asking" className="cmdk-group">
            {SUGGESTED.map((text) => (
              <Command.Item key={text} value={text} onSelect={() => ask(text)} className="cmdk-item">
                <Sparkles className="size-4 text-subtle" />
                <span className="truncate">{text}</span>
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="Preferences" className="cmdk-group">
            <Command.Item
              value="toggle theme dark light mode"
              onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}
              className="cmdk-item"
            >
              {resolvedTheme === "dark" ? <Sun className="size-4 text-subtle" /> : <Moon className="size-4 text-subtle" />}
              Switch to {resolvedTheme === "dark" ? "light" : "dark"} mode
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command>
    </div>,
    document.body,
  );
}
