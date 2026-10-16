import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/sources";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card", className)} {...props} />;
}

export function CardHeader({
  icon,
  title,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3 px-4 pt-4 pb-3", className)}>
      <div className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-fg">
        {icon && <span className="text-muted [&_svg]:size-4">{icon}</span>}
        <span className="truncate">{title}</span>
      </div>
      {action}
    </div>
  );
}

const toneClass: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok-fg",
  warn: "bg-warn-bg text-warn-fg",
  info: "bg-info-bg text-info-fg",
  neutral: "bg-neutral-bg text-neutral-fg",
  danger: "bg-danger-bg text-danger-fg",
};

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        toneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "icon";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium transition-[background,opacity,box-shadow,color] outline-none select-none",
        "focus-visible:ring-2 focus-visible:ring-c-blue/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        size === "sm" && "h-7 px-2.5 text-xs",
        size === "md" && "h-9 px-3.5",
        size === "icon" && "size-8",
        variant === "primary" && "btn-primary hover:opacity-90",
        variant === "secondary" && "border border-border bg-surface text-fg hover:bg-surface-3",
        variant === "ghost" && "text-muted hover:bg-surface-3 hover:text-fg",
        variant === "danger" && "bg-danger-bg text-danger-fg hover:opacity-85",
        className,
      )}
      {...props}
    />
  );
});

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-3", className)} />;
}

export function StatusDot({ tone, pulse }: { tone: "ok" | "warn" | "danger" | "neutral"; pulse?: boolean }) {
  const color = {
    ok: "bg-c-green",
    warn: "bg-c-amber",
    danger: "bg-danger-fg",
    neutral: "bg-subtle",
  }[tone];
  return (
    <span className="relative inline-flex size-2">
      {pulse && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", color)} />}
      <span className={cn("relative inline-flex size-2 rounded-full", color)} />
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 items-center rounded border border-border bg-surface-2 px-1.5 font-sans text-[10px] font-medium text-muted">
      {children}
    </kbd>
  );
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-xl border border-border bg-surface-2 text-muted [&_svg]:size-5">
        {icon}
      </div>
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-xs text-[13px] text-muted">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
