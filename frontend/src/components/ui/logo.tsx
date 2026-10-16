import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden="true">
      <defs>
        <linearGradient id="pf-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b3b42" />
          <stop offset="1" stopColor="#111114" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#pf-bg)" />
      <path d="M9 9.5h9.5a4.5 4.5 0 0 1 0 9H13" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M9 9.5V23" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="21.5" cy="22.5" r="2.2" fill="#7fb6e6" />
    </svg>
  );
}
