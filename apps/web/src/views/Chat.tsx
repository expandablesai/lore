// Chat: talk to the configured LLM with memory retrieval. The conversation is
// held in local state; each send posts the whole message list and appends the
// assistant reply. The newest user turn is the last item sent.
// Enter sends and Shift+Enter starts a new line, the convention for every chat
// box — but a bare Enter also commits an in-progress IME candidate, so the
// composition state is checked first or Chinese/Japanese input would send
// mid-sentence.
import { useCallback, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { api } from "../lib/api";
import type { ChatMessage } from "../lib/types";
import { Button, ErrorNote, Panel, StatusLine, errMessage, type ViewProps } from "./common";

export function Chat({ token }: ViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const send = useCallback(async () => {
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

  const onSend = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      void send();
    },
    [send],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      void send();
    },
    [send],
  );

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
              onKeyDown={onKeyDown}
              rows={2}
              aria-label="Message"
              placeholder="Message… (Enter sends, Shift+Enter for a new line)"
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
