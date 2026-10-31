// Chat: talk to the configured LLM with memory retrieval. The conversation is
// held in local state; each send posts the whole message list and appends the
// assistant reply. The newest user turn is the last item sent.
// Enter sends and Shift+Enter starts a new line, the convention for every chat
// box — but a bare Enter also commits an in-progress IME candidate, so the
// composition state is checked first or Chinese/Japanese input would send
// mid-sentence.
// Images the reply rests on arrive as document ids; they are fetched with the
// bearer token and shown under the answer.
import { useCallback, useEffect, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { api } from "../lib/api";
import type { ChatImage, ChatMessage } from "../lib/types";
import { Button, ErrorNote, Panel, StatusLine, errMessage, type ViewProps } from "./common";

/** One turn of the conversation, with whatever pictures came with it. */
interface Turn extends ChatMessage {
  images?: ChatImage[];
}

/** An image attachment: fetch its bytes, show them, release the object URL. */
function Attachment({ token, image }: { token: string; image: ChatImage }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    api
      .documentBlob(token, image.documentId)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((e: unknown) => {
        if (active) setError(errMessage(e));
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, image.documentId]);

  return (
    <figure className="max-w-[80%]">
      {url ? (
        <img
          src={url}
          alt={image.filename}
          className="rounded-xl border border-slate-700 bg-slate-950"
        />
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-400">
          {error ?? `Loading ${image.filename}…`}
        </div>
      )}
      <figcaption className="mt-1 truncate text-xs text-slate-500">{image.filename}</figcaption>
    </figure>
  );
}

export function Chat({ token }: ViewProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    const asked: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(asked);
    setDraft("");
    setSending(true);
    setError(null);
    try {
      const res = await api.chat(token, {
        // The wire format carries text only; images are retrieved server-side.
        messages: asked.map((t) => ({ role: t.role, content: t.content })),
      });
      setTurns((prev) => [
        ...prev,
        { role: res.message.role, content: res.message.content, images: res.images ?? [] },
      ]);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setSending(false);
    }
  }, [draft, sending, token, turns]);

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
            {turns.length === 0 && (
              <StatusLine>
                Ask something to start the conversation. Ask for a picture — "show me the portfolio" — and
                the images come with the answer.
              </StatusLine>
            )}
            {turns.map((turn, i) => (
              <div key={i} className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className="flex max-w-[80%] flex-col gap-2">
                  <div
                    className={
                      turn.role === "user"
                        ? "rounded-2xl bg-sky-500 px-4 py-2 text-sm text-white"
                        : "rounded-2xl bg-slate-800 px-4 py-2 text-sm text-slate-100"
                    }
                  >
                    {turn.content}
                  </div>
                  {(turn.images ?? []).map((image) => (
                    <Attachment key={image.documentId} token={token} image={image} />
                  ))}
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
