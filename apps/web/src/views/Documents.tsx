// Documents: list the workspace's documents and upload one or many files at
// once via multipart form data. Each file is its own request, so one bad file
// reports its own error instead of losing the whole selection.
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import type { DocumentSummary, Scope } from "../lib/types";
import { Button, Badge, ErrorNote, Panel, StatusLine, errMessage, type ViewProps } from "./common";

const SCOPES: Scope[] = ["personal", "project", "org"];

/** What happened to each file of a batch, in the order they were sent. */
interface UploadOutcome {
  filename: string;
  ok: boolean;
  detail: string;
  id?: string;
}

function statusTone(status: DocumentSummary["status"]): "emerald" | "amber" | "rose" | "slate" {
  if (status === "indexed") return "emerald";
  if (status === "failed") return "rose";
  if (status === "queued" || status === "extracting") return "amber";
  return "slate";
}

/** What an upload response means, in words. */
function outcomeOf(res: { id: string; status: string; deduplicated?: boolean; reprocessed?: boolean }): string {
  if (res.reprocessed) return "indexing again";
  if (res.deduplicated) return `already here (${res.status})`;
  return res.status;
}

export function Documents({ token, navigate }: ViewProps) {
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [scope, setScope] = useState<Scope>("personal");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcomes, setOutcomes] = useState<UploadOutcome[]>([]);

  const load = useCallback(() => {
    setError(null);
    api
      .documents(token)
      .then((res) => setDocs(res.documents))
      .catch((e: unknown) => setError(errMessage(e)));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function onUpload(event: FormEvent) {
    event.preventDefault();
    if (files.length === 0 || uploading) return;
    setUploading(true);
    setOutcomes([]);
    setProgress({ done: 0, total: files.length });

    const results: UploadOutcome[] = [];
    for (const file of files) {
      try {
        const res = await api.uploadDocument(token, file, scope);
        results.push({ filename: file.name, ok: true, detail: outcomeOf(res), id: res.id });
      } catch (e) {
        results.push({ filename: file.name, ok: false, detail: errMessage(e) });
      }
      setOutcomes([...results]);
      setProgress({ done: results.length, total: files.length });
    }

    setUploading(false);
    setFiles([]);
    setProgress(null);
    load();
    // One file is a navigation; a batch stays on the list so every result is visible.
    const only = results[0];
    if (results.length === 1 && only?.ok && only.id) navigate(`/documents/${only.id}`);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-100">Documents</h1>

      <Panel>
        <h2 className="mb-3 text-sm font-medium text-slate-200">Upload documents</h2>
        <form className="flex flex-wrap items-end gap-3" onSubmit={onUpload}>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-300">Files</span>
            <input
              type="file"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="block text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-slate-100"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-300">Scope</span>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as Scope)}
              className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100"
            >
              {SCOPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={files.length === 0 || uploading}>
            {uploading
              ? `Uploading ${progress ? `${progress.done + 1} of ${progress.total}` : "…"}`
              : files.length > 1
                ? `Upload ${files.length} files`
                : "Upload"}
          </Button>
        </form>
        {files.length > 0 && (
          <p className="mt-3 text-xs text-slate-400">
            {files.length === 1 ? files[0]?.name : `${files.length} files selected`}
          </p>
        )}
        {outcomes.length > 0 && (
          <ul className="mt-3 space-y-1">
            {outcomes.map((o) => (
              <li key={o.filename} className="flex items-baseline gap-2 text-xs">
                <span className={o.ok ? "text-emerald-300" : "text-rose-300"}>{o.ok ? "sent" : "failed"}</span>
                <span className="truncate text-slate-300">{o.filename}</span>
                <span className="text-slate-500">{o.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <h2 className="mb-3 text-sm font-medium text-slate-200">Library</h2>
        {error && <ErrorNote message={error} />}
        {!error && docs === null && <StatusLine>Loading documents…</StatusLine>}
        {docs !== null && docs.length === 0 && <StatusLine>No documents yet.</StatusLine>}
        {docs !== null && docs.length > 0 && (
          <ul className="divide-y divide-slate-800">
            {docs.map((doc) => (
              <li key={doc.id}>
                <button
                  onClick={() => navigate(`/documents/${doc.id}`)}
                  className="flex w-full items-start justify-between gap-3 py-3 text-left hover:bg-slate-800/40"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-slate-100">{doc.filename}</span>
                    {doc.status === "failed" && doc.error ? (
                      <span className="mt-1 block truncate text-xs text-rose-300">{doc.error}</span>
                    ) : (
                      <span className="mt-1 block text-xs text-slate-500">{doc.mime}</span>
                    )}
                  </span>
                  <Badge tone={statusTone(doc.status)}>{doc.status}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
