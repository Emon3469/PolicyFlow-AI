"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";

function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      position="bottom-right"
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      toastOptions={{ style: { fontSize: "13px", borderRadius: "12px" } }}
    />
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
      <ThemedToaster />
    </ThemeProvider>
  );
}
