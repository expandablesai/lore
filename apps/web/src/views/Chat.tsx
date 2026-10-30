// Chat: talk to the configured LLM with memory retrieval. The conversation is
// held in local state; each send posts the whole message list and appends the
// assistant reply. The newest user turn is the last item sent.
import { useCallback, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import type { ChatMessage } from "../lib/types";
import { Button, ErrorNote, Panel, StatusLine, errMessage, type ViewProps } from "./common";

export function Chat({ token }: ViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const onSend = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setDraft("");
    setSending(true);
    setError(null);
    try {
      const res = await api.chat(token, { messages: next });
      setMessages((prev) => [...prev, res.message]);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setSending(false);
    }
  }, [draft, messages, sending, token]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-100">Chat</h1>
      <Panel>
        <div className="flex h-[60vh] flex-col gap-4">
          <div className="flex-1 space-y-3 overflow-y-auto">
            {messages.length === 0 && <StatusLine>Ask something to start the conversation.</StatusLine>}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[80%] rounded-2xl bg-sky-500 px-4 py-2 text-sm text-white"
                      : "max-w-[80%] rounded-2xl bg-slate-800 px-4 py-2 text-sm text-slate-100"
                  }
                >
                  {m.content}
                </div>
              </div>
            ))}
            {sending && <StatusLine>Thinking…</StatusLine>}
          </div>
          {error && <ErrorNote message={error} />}
          <form className="flex items-end gap-3" onSubmit={onSend}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              placeholder="Message…"
              className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
            />
            <Button type="submit" variant="primary" disabled={sending || draft.trim() === ""}>
              {sending ? "Sending…" : "Send"}
            </Button>
          </form>
        </div>
      </Panel>
    </div>
  );
}
