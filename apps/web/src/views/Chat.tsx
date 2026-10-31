// Chat: a ChatGPT-shaped thread backed by stored history.
//
// The conversation id in the route decides which chat is open; a missing id is
// a new chat, and the first question creates the thread (named after itself) so
// it appears in the sidebar immediately. Enter sends, Shift+Enter adds a line,
// and an in-progress IME composition keeps its Enter.
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Avatar, BrainMark } from "../components/Brand";
import type { ChatImage, ChatMessage } from "../lib/types";
import { Button, ErrorNote, StatusLine, errMessage, type ViewProps } from "./common";
import { DownloadAllButton, ImageThumb, ImageViewer } from "./ImageViewer";

/** One turn of the conversation, with whatever pictures came with it. */
interface Turn extends ChatMessage {
  images?: ChatImage[];
}

/**
 * The reply text without image markdown.
 *
 * Told that an image is on screen, a model tends to add `![name](name)` to its
 * answer. The console renders that as literal characters next to the picture it
 * is actually showing, so the link is dropped and the attachment speaks for it.
 */
function visibleText(turn: Turn): string {
  if (turn.role !== "assistant") return turn.content;
  return turn.content.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** What to render for an answer that carried no text at all. */
function answerText(turn: Turn, t: (m: string) => string): string {
  const text = visibleText(turn);
  if (text !== "") return text;
  return (turn.images ?? []).length > 0 ? "" : t("No answer came back for that one.");
}

/** Tell the shell that the chat list changed. */
function announceHistoryChange() {
  window.dispatchEvent(new Event("lore:chats-changed"));
}

export function Chat({ token, user, chatId, navigate }: ViewProps & { chatId?: string }) {
  const { me } = useAuth();
  const { t } = useI18n();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [viewing, setViewing] = useState<ChatImage | null>(null);

  // The conversation the route points at, mirrored in a ref: an answer that
  // arrives after the user has opened another chat has to be recognised as
  // stale, because this component is reused across /chat/:id routes and the
  // transcript on screen is no longer the one that asked.
  const shown = useRef(chatId);
  useEffect(() => {
    shown.current = chatId;
  }, [chatId]);

  // Opening a saved conversation replaces the transcript; a new chat starts empty.
  useEffect(() => {
    if (!chatId) {
      setTurns([]);
      // The previous chat's history request is now irrelevant: its cleanup only
      // clears a flag this effect never sets again, so the spinner has to be
      // cleared here or "Loading conversation…" outlives the conversation.
      setLoadingHistory(false);
      setError(null);
      return;
    }
    let active = true;
    setLoadingHistory(true);
    setError(null);
    api
      .chatHistory(token, chatId)
      .then((res) => {
        if (!active) return;
        setTurns(
          res.messages.map((m) => ({ role: m.role, content: m.content, images: m.images })),
        );
      })
      .catch((e: unknown) => {
        if (active) setError(errMessage(e));
      })
      .finally(() => {
        if (active) setLoadingHistory(false);
      });
    return () => {
      active = false;
    };
  }, [token, chatId]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    const askedIn = chatId;
    const asked: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(asked);
    setDraft("");
    setSending(true);
    setError(null);
    try {
      const res = await api.chat(token, {
        chatId,
        // The wire format carries text only; images are retrieved server-side.
        messages: asked.map((t) => ({ role: t.role, content: t.content })),
      });
      // Asked in one conversation, answered after the user opened another: drop
      // the reply instead of appending it to someone else's transcript.
      if (shown.current !== askedIn) return;
      setTurns((prev) => [
        ...prev,
        { role: res.message.role, content: res.message.content, images: res.images ?? [] },
      ]);
      announceHistoryChange();
      // The first turn created the thread: put its id in the route so the
      // sidebar entry and a reload both point at the conversation.
      if (!chatId) navigate(`/chat/${res.chatId}`);
    } catch (e) {
      if (shown.current === askedIn) {
        // Nothing was stored, so the optimistic turn is a lie: take it back and
        // return the text to the composer, or the next question re-sends a
        // message that never went anywhere.
        setTurns((prev) =>
          prev.length === asked.length && prev[prev.length - 1]?.content === text
            ? asked.slice(0, -1)
            : prev,
        );
        setDraft((current) => (current.trim() === "" ? text : current));
        setError(errMessage(e));
      }
    } finally {
      setSending(false);
    }
  }, [chatId, draft, navigate, sending, token, turns]);

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

  const empty = turns.length === 0 && !loadingHistory;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <header className="glass sticky top-0 z-10 mb-4 flex items-center justify-between gap-4 rounded-2xl px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-100">{t("Chat")}</h1>
          <p className="text-xs text-slate-400">
            {t("Answers are grounded in your documents and images.")}
          </p>
        </div>
        <Button variant="ghost" onClick={() => navigate("/chat")}>
          {t("New chat")}
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto pr-1">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-6">
          {empty && (
            <div className="glass glass-sheen rise rounded-3xl p-8 text-center">
              <p className="text-sm font-medium text-slate-200">{t("Ask anything about your workspace")}</p>
              <p className="mt-2 text-sm text-slate-400">
                Upload a script, a PDF or a picture, then ask about it. “Show me the character
                sheet” brings the image back with the answer.
              </p>
            </div>
          )}

          {loadingHistory && <StatusLine>{t("Loading conversation…")}</StatusLine>}

          {turns.map((turn, index) =>
            turn.role === "user" ? (
              <div key={index} className="rise flex items-end justify-end gap-2">
                <div className="bubble-user max-w-[85%] rounded-3xl rounded-br-lg px-4 py-2.5 text-sm text-white shadow-lg shadow-sky-500/20 [background:var(--bubble-user)]">
                  {turn.content}
                </div>
                <Avatar
                  token={token}
                  userId={user.id}
                  hasAvatar={Boolean(me?.hasAvatar)}
                  name={user.displayName}
                  size={28}
                />
              </div>
            ) : (
              <article key={index} className="rise flex gap-3">
                <span className="mt-0.5 shrink-0">
                  <BrainMark size={28} />
                </span>
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
                    {answerText(turn, t)}
                  </div>
                  {(turn.images ?? []).length > 0 && (
                    <>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {(turn.images ?? []).map((image) => (
                          <ImageThumb
                            key={image.documentId}
                            token={token}
                            image={image}
                            onOpen={() => setViewing(image)}
                          />
                        ))}
                      </div>
                      <DownloadAllButton token={token} images={turn.images ?? []} />
                    </>
                  )}
                </div>
              </article>
            ),
          )}

          {sending && (
            <div className="flex gap-3">
              <BrainMark size={28} />
              <p className="text-sm text-slate-400">{t("Thinking…")}</p>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl pt-3">
        {error && (
          <div className="mb-2">
            <ErrorNote message={error} />
          </div>
        )}
        <form onSubmit={onSend} className="glass-strong glass-sheen neon-frame flex items-end gap-2 rounded-[26px] p-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            aria-label="Message"
            placeholder={t("Message LORE… (Enter sends, Shift+Enter for a new line)")}
            className="max-h-40 min-h-[42px] w-full resize-none bg-transparent px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          <Button type="submit" disabled={sending || draft.trim() === ""} className="shrink-0">
            {sending ? "…" : t("Send")}
          </Button>
        </form>
      </div>

      {viewing && <ImageViewer token={token} image={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
