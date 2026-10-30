// Document detail: metadata, extracted chunks, and a reprocess action.
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Chunk, DocumentDetail as DocumentDetailData } from "../lib/types";
import { Badge, Button, ErrorNote, Panel, StatusLine, errMessage, type ViewProps } from "./common";

interface DetailState {
  document: DocumentDetailData;
  chunks: Chunk[];
}

export function DocumentDetail({ token, id, navigate }: ViewProps & { id: string }) {
  const [state, setState] = useState<DetailState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api
      .document(token, id)
      .then((res) => setState(res))
      .catch((e: unknown) => setError(errMessage(e)));
  }, [token, id]);

  useEffect(() => {
    load();
  }, [load]);

  async function onReprocess() {
    setBusy(true);
    setError(null);
    try {
      await api.reprocessDocument(token, id);
      load();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={() => navigate("/documents")}>
          ← Back
        </Button>
        <h1 className="text-xl font-semibold text-slate-100">{state?.document.filename ?? "Document"}</h1>
      </div>

      {error && <ErrorNote message={error} />}
      {!error && state === null && <StatusLine>Loading document…</StatusLine>}

      {state && (
        <>
          <Panel>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-slate-500">Status</dt>
                <dd className="mt-0.5">
                  <Badge tone={state.document.status === "indexed" ? "emerald" : "amber"}>{state.document.status}</Badge>
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Scope</dt>
                <dd className="mt-0.5 text-slate-200">{state.document.scope}</dd>
              </div>
              <div>
                <dt className="text-slate-500">MIME</dt>
                <dd className="mt-0.5 text-slate-200">{state.document.mime}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Size</dt>
                <dd className="mt-0.5 text-slate-200">{state.document.sizeBytes} bytes</dd>
              </div>
              <div>
                <dt className="text-slate-500">Pages</dt>
                <dd className="mt-0.5 text-slate-200">{state.document.pageCount ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">SHA-256</dt>
                <dd className="mt-0.5 truncate font-mono text-xs text-slate-300">{state.document.sha256}</dd>
              </div>
            </dl>
            {state.document.error && (
              <div className="mt-4">
                <ErrorNote message={state.document.error} />
              </div>
            )}
            <div className="mt-4">
              <Button variant="ghost" onClick={onReprocess} disabled={busy}>
                {busy ? "Reprocessing…" : "Reprocess"}
              </Button>
            </div>
          </Panel>

          <Panel>
            <h2 className="mb-3 text-sm font-medium text-slate-200">Chunks ({state.chunks.length})</h2>
            {state.chunks.length === 0 ? (
              <StatusLine>No chunks extracted.</StatusLine>
            ) : (
              <ol className="space-y-3">
                {state.chunks.map((chunk) => (
                  <li key={chunk.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                    <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                      <span>#{chunk.seq}</span>
                      <span>{chunk.tokens} tokens</span>
                    </div>
                    <p className="text-sm text-slate-200">{chunk.text}</p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
