// Shared view contract and the glass primitives every screen is built from.
// Day mode is a palette swap (see index.css), so components describe surfaces
// rather than colours.
import { cn } from "@lore/ui";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { ApiError } from "../lib/api";
import type { AuthUser } from "../lib/types";

export interface ViewProps {
  token: string;
  user: AuthUser;
  navigate: (path: string) => void;
}

export function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message.length > 0) return e.message;
  return "Request failed";
}

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("glass glass-sheen neon-frame rounded-3xl p-5", className)}>{children}</div>
  );
}

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "quiet" }) {
  return (
    <button
      className={cn(
        "liquid-lift inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" &&
          "text-[var(--accent-contrast)] shadow-lg shadow-sky-500/25 [background:linear-gradient(135deg,var(--accent),#7cb8ff)] hover:brightness-110",
        variant === "ghost" &&
          "glass border text-slate-200 hover:text-slate-100",
        variant === "quiet" && "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200",
        variant === "danger" &&
          "bg-rose-500/90 text-white shadow-lg shadow-rose-500/20 hover:bg-rose-500",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <input
        className={cn(
          "w-full rounded-2xl border border-[rgb(var(--glass-border))] bg-[rgb(var(--glass))] px-3.5 py-2.5 text-sm text-slate-100",
          "backdrop-blur-xl placeholder:text-slate-500 transition focus:border-sky-400/60 focus:outline-none",
          "focus:ring-2 focus:ring-sky-400/20",
          className,
        )}
        {...props}
      />
    </label>
  );
}

export function Badge({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: "slate" | "sky" | "emerald" | "amber" | "rose";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-md",
        tone === "slate" && "bg-slate-800/70 text-slate-300",
        tone === "sky" && "bg-sky-500/15 text-sky-300",
        tone === "emerald" && "bg-emerald-500/15 text-emerald-300",
        tone === "amber" && "bg-amber-500/15 text-amber-300",
        tone === "rose" && "bg-rose-500/15 text-rose-300",
      )}
    >
      {children}
    </span>
  );
}

export function StatusLine({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-400">{children}</p>;
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-sm text-rose-200 backdrop-blur-md"
    >
      {message}
    </p>
  );
}
