// Console shell: a glass sidebar (navigation, saved conversations, theme) and
// the routed view. Views receive the bearer token, the signed-in user and the
// navigate helper as props.
import { cn } from "@lore/ui";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "./lib/api";
import { useAuth } from "./lib/auth";
import { useNav } from "./lib/nav";
import { useTheme, type Theme } from "./lib/theme";
import type { ChatSummary } from "./lib/types";
import { Chat } from "./views/Chat";
import { Dashboard } from "./views/Dashboard";
import { DocumentDetail } from "./views/DocumentDetail";
import { Documents } from "./views/Documents";
import { LlmKeys } from "./views/LlmKeys";
import { Members } from "./views/Members";
import { Memory } from "./views/Memory";
import { Button, type ViewProps } from "./views/common";

const NAV: { label: string; path: string; adminOnly?: boolean }[] = [
  { label: "Dashboard", path: "/" },
  { label: "Chat", path: "/chat" },
  { label: "Documents", path: "/documents" },
  { label: "Memory", path: "/memory" },
  { label: "Members", path: "/members" },
  { label: "LLM Keys", path: "/llm-keys", adminOnly: true },
];

const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "Day" },
  { value: "dark", label: "Night" },
  { value: "system", label: "Auto" },
];

function isActive(path: string, target: string): boolean {
  if (target === "/") return path === "/";
  return path === target || path.startsWith(`${target}/`);
}

/** A saved conversation: click to open, × to delete. */
function ChatRow({
  chat,
  active,
  onOpen,
  onDelete,
}: {
  chat: ChatSummary;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "w-full truncate rounded-xl px-3 py-2 pr-8 text-left text-[13px] transition",
          active
            ? "bg-slate-800/70 text-slate-100"
            : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200",
        )}
        title={chat.title}
      >
        {chat.title}
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        aria-label={`Delete ${chat.title}`}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-xs text-slate-500 opacity-0 transition hover:bg-rose-500/20 hover:text-rose-300 group-hover:opacity-100"
      >
        ×
      </button>
    </li>
  );
}

export function Shell() {
  const { user, token, logout } = useAuth();
  const { path, navigate } = useNav();
  const { theme, setTheme } = useTheme();
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  const loadChats = useCallback(() => {
    if (!token) return;
    api
      .chats(token)
      .then(setChats)
      .catch(() => setChats([]));
  }, [token]);

  useEffect(() => {
    loadChats();
    const refresh = () => loadChats();
    window.addEventListener("lore:chats-changed", refresh);
    return () => window.removeEventListener("lore:chats-changed", refresh);
  }, [loadChats]);

  useEffect(() => {
    setMenuOpen(false);
  }, [path]);

  if (!user || !token) return null;

  const viewProps: ViewProps = { token, user, navigate };

  let view: ReactNode;
  if (path === "/") view = <Dashboard {...viewProps} />;
  else if (path === "/chat") view = <Chat {...viewProps} />;
  else if (path.startsWith("/chat/"))
    view = <Chat {...viewProps} chatId={decodeURIComponent(path.slice("/chat/".length))} />;
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

  const activeChatId = path.startsWith("/chat/") ? path.slice("/chat/".length) : undefined;

  const sidebar = (
    <aside className="glass flex w-72 shrink-0 flex-col gap-5 rounded-3xl p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold tracking-tight text-slate-100">EXPANDABLES LORE</p>
          <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Memory OS</p>
        </div>
        <button
          type="button"
          onClick={() => setMenuOpen(false)}
          className="rounded-lg px-2 py-1 text-slate-500 hover:text-slate-300 lg:hidden"
          aria-label="Close menu"
        >
          ×
        </button>
      </div>

      <Button onClick={() => navigate("/chat")} className="w-full">
        New chat
      </Button>

      <nav className="flex min-h-0 flex-col gap-1">
        {NAV.filter((item) => !item.adminOnly || user.role === "superadmin" || user.role === "org_admin").map(
          (item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                "rounded-xl px-3 py-2 text-left text-sm transition",
                isActive(path, item.path)
                  ? "bg-slate-800/70 text-slate-100"
                  : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200",
              )}
            >
              {item.label}
            </button>
          ),
        )}
      </nav>

      <div className="flex min-h-0 flex-1 flex-col">
        <p className="mb-1 px-3 text-[11px] uppercase tracking-[0.14em] text-slate-500">Recent chats</p>
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
          {chats.length === 0 && (
            <li className="px-3 py-2 text-[13px] text-slate-500">No conversations yet.</li>
          )}
          {chats.map((chat) => (
            <ChatRow
              key={chat.id}
              chat={chat}
              active={chat.id === activeChatId}
              onOpen={() => navigate(`/chat/${chat.id}`)}
              onDelete={() => {
                void api.deleteChat(token, chat.id).then(() => {
                  loadChats();
                  if (chat.id === activeChatId) navigate("/chat");
                });
              }}
            />
          ))}
        </ul>
      </div>

      <div className="space-y-3 border-t border-[rgb(var(--glass-border))] pt-3">
        <div className="flex rounded-full bg-slate-800/50 p-1 text-xs">
          {THEMES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setTheme(option.value)}
              aria-pressed={theme === option.value}
              className={cn(
                "flex-1 rounded-full px-2 py-1.5 transition",
                theme === option.value
                  ? "bg-slate-100 text-slate-900 shadow"
                  : "text-slate-400 hover:text-slate-200",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div>
          <p className="truncate text-sm text-slate-300">{user.displayName}</p>
          <p className="mb-2 truncate text-xs text-slate-500">{user.email}</p>
          <Button variant="quiet" className="w-full justify-start px-3" onClick={logout}>
            Sign out
          </Button>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen gap-4 p-4">
      <div className="hidden lg:block">{sidebar}</div>

      {menuOpen && (
        <div className="fixed inset-0 z-40 flex bg-black/40 backdrop-blur-sm lg:hidden" onClick={() => setMenuOpen(false)}>
          <div onClick={(event) => event.stopPropagation()}>{sidebar}</div>
        </div>
      )}

      <main className="min-w-0 flex-1">
        <div className="mb-3 flex items-center gap-3 lg:hidden">
          <Button variant="ghost" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            ☰
          </Button>
          <span className="text-sm font-medium text-slate-200">EXPANDABLES LORE</span>
        </div>
        {view}
      </main>
    </div>
  );
}
