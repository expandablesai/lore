// Capture: a paste-first intake. Drop text or images in, press Enter (or Send),
// and the console writes them into the workspace and reports exactly what was
// stored and indexed — with the timestamps and the person who saved it.
import { useCallback, useRef, useState } from "react";
import type { ClipboardEvent, FormEvent, KeyboardEvent } from "react";
import { api } from "../lib/api";
import type { DocumentDetail, DocumentSummary } from "../lib/types";
import { Button, ErrorNote, Panel, StatusLine, errMessage, type ViewProps } from "./common";

/** A file waiting to be written into the workspace. */
interface Pending {
  key: string;
  name: string;
  file: File;
  preview: string | null;
}

/** What the server said, plus what it looked like once indexing finished. */
interface Receipt {
  id: string;
  name: string;
  status: "queued" | "extracting" | "indexed" | "failed";
  detail: DocumentDetail | null;
  error: string | null;
}

function when(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function noteName(text: string): string {
  const firstLine = text.trim().split("\n")[0] ?? "";
  const slug = firstLine
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return `${slug || "note"}-${stamp}.md`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Poll one document until the worker has finished with it. */
async function settle(token: string, id: string): Promise<DocumentDetail | null> {
  const deadline = Date.now() + 120_000;
  let latest: DocumentDetail | null = null;
  while (Date.now() < deadline) {
    const res = await api.document(token, id);
    latest = res.document;
    if (res.document.status === "indexed" || res.document.status === "failed") return res.document;
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
  return latest;
}

export function Capture({ token, navigate }: ViewProps) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const addFiles = useCallback((files: File[]) => {
    const usable = files.filter(
      (f) =>
        f.type === "image/png" ||
        f.type === "image/jpeg" ||
        f.type === "image/webp" ||
        f.type.startsWith("text/") ||
        f.name.endsWith(".md") ||
        f.name.endsWith(".txt"),
    );
    setPending((prev) => [
      ...prev,
      ...usable.map((file) => ({
        key: `${file.name}-${file.size}-${crypto.randomUUID()}`,
        name: file.name || "pasted.png",
        file,
        preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      })),
    ]);
  }, []);

  // Images arrive as clipboard items; text is left to the textarea.
  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const items = Array.from(event.clipboardData?.items ?? []);
      const files = items
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      if (files.length > 0) {
        event.preventDefault();
        addFiles(files);
      }
    },
    [addFiles],
  );

  const onFiles = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      addFiles(Array.from(event.target.files ?? []));
      event.target.value = "";
    },
    [addFiles],
  );

  const submit = useCallback(async () => {
    const body = text.trim();
    if ((body === "" && pending.length === 0) || busy) return;
    setBusy(true);
    setError(null);
    setReceipts([]);

    const jobs: Array<{ name: string; file: File }> = [];
    if (body !== "") {
      const name = noteName(body);
      jobs.push({ name, file: new File([body], name, { type: "text/markdown" }) });
    }
    for (const item of pending) jobs.push({ name: item.name, file: item.file });

    const collected: Receipt[] = [];
    for (const job of jobs) {
      try {
        const uploaded = await api.uploadDocument(token, job.file, "org");
        collected.push({ id: uploaded.id, name: job.name, status: "queued", detail: null, error: null });
        setReceipts([...collected]);
        const settled = await settle(token, uploaded.id);
        const updated: Receipt = {
          id: uploaded.id,
          name: job.name,
          status: (settled?.status ?? "queued") as Receipt["status"],
          detail: settled,
          error: settled?.error ?? null,
        };
        const at = collected.findIndex((r) => r.id === uploaded.id);
        collected[at] = updated;
        setReceipts([...collected]);
      } catch (e) {
        collected.push({ id: "", name: job.name, status: "failed", detail: null, error: errMessage(e) });
        setReceipts([...collected]);
      }
    }

    setBusy(false);
    setText("");
    setPending([]);
    window.dispatchEvent(new Event("lore:chats-changed"));
  }, [busy, pending, text, token]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      void submit();
    },
    [submit],
  );

  const indexed = receipts.filter((r) => r.status === "indexed").length;
  const failed = receipts.filter((r) => r.status === "failed").length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-slate-100">Paste</h1>
        <p className="text-xs text-slate-400">
          Paste text or images, press Enter, and LORE writes them into the workspace.
        </p>
      </header>

      <div onPaste={onPaste}>
        <Panel>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={8}
            aria-label="Paste text"
            placeholder="Paste text here — a note, a transcript, a brief. Enter saves it, Shift+Enter adds a line."
            className="w-full resize-y rounded-2xl border border-[rgb(var(--glass-border))] bg-[rgb(var(--glass))] px-4 py-3 text-sm leading-relaxed text-slate-100 placeholder:text-slate-500 focus:border-sky-400/60 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
          />

          {pending.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-3">
              {pending.map((item) => (
                <li key={item.key} className="relative">
                  {item.preview ? (
                    <img
                      src={item.preview}
                      alt={item.name}
                      className="h-20 w-20 rounded-xl border border-[rgb(var(--glass-border))] object-cover"
                    />
                  ) : (
                    <span className="glass block max-w-[12rem] truncate rounded-xl px-3 py-2 text-xs text-slate-300">
                      {item.name}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${item.name}`}
                    onClick={() => setPending((prev) => prev.filter((p) => p.key !== item.key))}
                    className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-slate-900/90 text-xs text-slate-300"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => void submit()} disabled={busy || (text.trim() === "" && pending.length === 0)}>
              {busy ? "Saving…" : "Save & index"}
            </Button>
            <label className="glass liquid-lift cursor-pointer rounded-full px-4 py-2 text-sm text-slate-200">
              Attach images
              <input type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={onFiles} className="hidden" />
            </label>
            <span className="text-xs text-slate-500">
              {text.trim() === "" && pending.length === 0
                ? "Nothing to save yet"
                : `${text.trim() === "" ? 0 : 1} note · ${pending.length} image${pending.length === 1 ? "" : "s"}`}
            </span>
          </div>
          {error && <div className="mt-3"><ErrorNote message={error} /></div>}
        </Panel>
      </div>

      {receipts.length > 0 && (
        <Panel>
          <h2 className="mb-1 text-sm font-medium text-slate-200">Saved</h2>
          <p className="mb-3 text-xs text-slate-400">
            {indexed} indexed{failed > 0 ? ` · ${failed} failed` : ""} ·{" "}
            {busy ? "still working…" : "done"}
          </p>
          <ul className="divide-y divide-[rgb(var(--glass-border))]">
            {receipts.map((receipt) => {
              const detail = receipt.detail;
              return (
                <li key={receipt.id || receipt.name} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-100">{receipt.name}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {detail
                          ? `${detail.mime} · ${formatBytes(detail.sizeBytes)} · ${detail.chunkCount} chunk${detail.chunkCount === 1 ? "" : "s"}`
                          : receipt.error ?? "queued"}
                      </p>
                      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-400 sm:grid-cols-3">
                        <div>
                          <dt className="text-slate-500">Saved</dt>
                          <dd>{when(detail?.createdAt)}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Indexed</dt>
                          <dd>{when(detail?.extractedAt)}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">By</dt>
                          <dd>{detail?.uploadedByName ?? "—"}</dd>
                        </div>
                      </dl>
                      {receipt.error && receipt.status === "failed" && (
                        <p className="mt-2 text-xs text-rose-300">{receipt.error}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={
                          "rounded-full px-2.5 py-0.5 text-[11px] " +
                          (receipt.status === "indexed"
                            ? "bg-emerald-500/15 text-emerald-300"
                            : receipt.status === "failed"
                              ? "bg-rose-500/15 text-rose-300"
                              : "bg-amber-500/15 text-amber-300")
                        }
                      >
                        {receipt.status}
                      </span>
                      {receipt.id && (
                        <Button variant="ghost" onClick={() => navigate(`/documents/${receipt.id}`)}>
                          Open
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {receipts.length === 0 && (
        <Panel>
          <StatusLine>
            Saved items appear in Documents with their metadata. Indexing usually finishes within a
            few seconds.
          </StatusLine>
        </Panel>
      )}
    </div>
  );
}

/** Exported for tests: the filename a pasted note is stored under. */
export const __noteNameForTest = noteName;

/** Re-exported so the list view can format the same way. */
export const __whenForTest = when;

export type { DocumentSummary };
