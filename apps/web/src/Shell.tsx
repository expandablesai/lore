// Console shell: persistent sidebar plus the hash-routed view. Views receive
// the bearer token, the signed-in user, and the navigate helper as props.
import { cn } from "@lore/ui";
import type { ReactNode } from "react";
import { useAuth } from "./lib/auth";
import { useNav } from "./lib/nav";
import { Dashboard } from "./views/Dashboard";
import { DocumentDetail } from "./views/DocumentDetail";
import { Documents } from "./views/Documents";
import { LlmKeys } from "./views/LlmKeys";
import { Members } from "./views/Members";
import { Memory } from "./views/Memory";
import { Button, type ViewProps } from "./views/common";

const NAV: { label: string; path: string; adminOnly?: boolean }[] = [
  { label: "Dashboard", path: "/" },
  { label: "Documents", path: "/documents" },
  { label: "Memory", path: "/memory" },
  { label: "Members", path: "/members" },
  { label: "LLM Keys", path: "/llm-keys", adminOnly: true },
];

function isActive(path: string, target: string): boolean {
  if (target === "/") return path === "/";
  return path === target || path.startsWith(`${target}/`);
}

export function Shell() {
  const { user, token, logout } = useAuth();
  const { path, navigate } = useNav();
  if (!user || !token) return null;

  const viewProps: ViewProps = { token, user, navigate };

  let view: ReactNode;
  if (path === "/") view = <Dashboard {...viewProps} />;
  else if (path === "/documents") view = <Documents {...viewProps} />;
  else if (path.startsWith("/documents/"))
    view = <DocumentDetail {...viewProps} id={decodeURIComponent(path.slice("/documents/".length))} />;
  else if (path === "/memory") view = <Memory {...viewProps} />;
  else if (path === "/members") view = <Members {...viewProps} />;
  else if (path === "/llm-keys") view = <LlmKeys {...viewProps} />;
  else
    view = (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-slate-100">Not found</h1>
        <Button variant="ghost" onClick={() => navigate("/")}>
          Back to dashboard
        </Button>
      </div>
    );

  return (
    <div className="min-h-screen lg:flex">
      <aside className="flex shrink-0 flex-col gap-6 border-b border-slate-800 bg-slate-950/50 p-5 lg:min-h-screen lg:w-60 lg:border-b-0 lg:border-r">
        <div>
          <p className="text-sm font-semibold text-slate-100">EXPANDABLES LORE</p>
          <p className="text-xs text-slate-500">Admin Console</p>
        </div>
        <nav className="flex gap-1 lg:flex-col">
          {NAV.filter((item) => !item.adminOnly || user.role === "superadmin" || user.role === "org_admin").map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                "rounded-lg px-3 py-2 text-left text-sm transition",
                isActive(path, item.path) ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200",
              )}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto hidden lg:block">
          <p className="truncate text-sm text-slate-300">{user.displayName}</p>
          <p className="mb-2 truncate text-xs text-slate-500">{user.email}</p>
          <Button variant="ghost" className="w-full" onClick={logout}>
            Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 p-6 lg:p-8">{view}</main>
    </div>
  );
}
