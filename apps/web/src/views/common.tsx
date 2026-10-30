// Shared view contract and small Tailwind primitives so every console view
// stays visually consistent without pulling in a component library.
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
    <div className={cn("rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-sm", className)}>
      {children}
    </div>
  );
}

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-sm font-medium transition",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-sky-500 text-white hover:bg-sky-400",
        variant === "ghost" && "border border-slate-700 text-slate-200 hover:bg-slate-800",
        variant === "danger" && "bg-rose-600 text-white hover:bg-rose-500",
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
      <span className="text-sm font-medium text-slate-300">{label}</span>
      <input
        className={cn(
          "w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100",
          "placeholder:text-slate-500 focus:border-sky-500 focus:outline-none",
          className,
        )}
        {...props}
      />
    </label>
  );
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "sky" | "emerald" | "amber" | "rose" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        tone === "slate" && "bg-slate-800 text-slate-300",
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
    <p role="alert" className="rounded-lg border border-rose-800 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
      {message}
    </p>
  );
}
