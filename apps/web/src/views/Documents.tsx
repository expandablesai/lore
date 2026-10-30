// Documents: list the workspace's documents and upload a new one via
// multipart form data, then jump to its detail page.
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import type { DocumentSummary, Scope } from "../lib/types";
import { Button, ErrorNote, Panel, StatusLine, errMessage, type ViewProps } from "./common";

const SCOPES: Scope[] = ["personal", "project", "org"];

export function Documents({ token, navigate }: ViewProps) {
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [scope, setScope] = useState<Scope>("personal");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

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
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const res = await api.uploadDocument(token, file, scope);
      navigate(`/documents/${res.id}`);
    } catch (e) {
      setUploadError(errMessage(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-100">Documents</h1>

      <Panel>
        <h2 className="mb-3 text-sm font-medium text-slate-200">Upload a document</h2>
        <form className="flex flex-wrap items-end gap-3" onSubmit={onUpload}>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-300">File</span>
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
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
          <Button type="submit" disabled={!file || uploading}>
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </form>
        {uploadError && (
          <div className="mt-3">
            <ErrorNote message={uploadError} />
          </div>
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
                  className="flex w-full items-center justify-between py-3 text-left hover:bg-slate-800/40"
                >
                  <span className="text-sm text-slate-100">{doc.filename}</span>
                  <span className="text-xs text-slate-500">
                    {doc.mime} · {doc.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
