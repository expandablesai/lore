// LlmKeys: list the organization's LLM provider keys and (for admins) add,
// revoke, and test them. The API key is write-only — it is never shown after
// the add form collects it once. A provider preset prefills the base URL and
// models; every field stays editable so any OpenAI-compatible endpoint works.
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import type { OrgLlmKey } from "../lib/types";
import { Badge, Button, ErrorNote, Field, Panel, StatusLine, errMessage, type ViewProps } from "./common";

interface ProviderPreset {
  id: string;
  label: string;
  apiType: "openai" | "anthropic";
  baseUrl: string;
  chatModel: string;
  embedModel: string;
  embedDim: number;
}

const PROVIDERS: ProviderPreset[] = [
  { id: "openai", label: "OpenAI", apiType: "openai", baseUrl: "https://api.openai.com/v1", chatModel: "gpt-4o", embedModel: "text-embedding-3-large", embedDim: 3072 },
  { id: "deepseek", label: "DeepSeek", apiType: "openai", baseUrl: "https://api.deepseek.com/v1", chatModel: "deepseek-chat", embedModel: "text-embedding-3-large", embedDim: 3072 },
  { id: "cloudflare", label: "Workers AI", apiType: "openai", baseUrl: "https://api.cloudflare.com/client/v4/accounts/ffe48f1d86b4606ca1c512cc2b522e99/ai/v1", chatModel: "@cf/meta/llama-3.2-3b-instruct", embedModel: "@cf/baai/bge-base-en-v1.5", embedDim: 768 },
  { id: "ollama", label: "Ollama", apiType: "openai", baseUrl: "http://localhost:11434/v1", chatModel: "llama3.1", embedModel: "nomic-embed-text", embedDim: 768 },
  { id: "claude", label: "Claude", apiType: "anthropic", baseUrl: "https://api.anthropic.com/v1", chatModel: "claude-3-5-sonnet-latest", embedModel: "", embedDim: 0 },
  { id: "strata", label: "Strata", apiType: "openai", baseUrl: "", chatModel: "", embedModel: "", embedDim: 0 },
  { id: "custom", label: "Custom", apiType: "openai", baseUrl: "", chatModel: "", embedModel: "", embedDim: 0 },
];

function canManage(role: string): boolean {
  return role === "superadmin" || role === "org_admin";
}

export function LlmKeys({ token, user }: ViewProps) {
  const orgId = user.orgId;
  const [keys, setKeys] = useState<OrgLlmKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState("openai");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [chatModel, setChatModel] = useState("gpt-4o");
  const [embedModel, setEmbedModel] = useState("text-embedding-3-large");
  const [embedDim, setEmbedDim] = useState(3072);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .orgLlmKeys(token, orgId)
      .then((res) => setKeys(res))
      .catch((e: unknown) => setError(errMessage(e)));
  }, [token, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  function selectProvider(id: string) {
    setProvider(id);
    const preset = PROVIDERS.find((p) => p.id === id);
    if (!preset) return;
    setBaseUrl(preset.baseUrl);
    setChatModel(preset.chatModel);
    setEmbedModel(preset.embedModel);
    setEmbedDim(preset.embedDim || 3072);
  }

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    setAdding(true);
    setAddError(null);
    try {
      const preset = PROVIDERS.find((p) => p.id === provider);
      await api.addLlmKey(token, orgId, { label, apiKey, provider, apiType: preset?.apiType ?? "openai", baseUrl, chatModel, embedModel, embedDim });
      setLabel("");
      setApiKey("");
      load();
    } catch (e) {
      setAddError(errMessage(e));
    } finally {
      setAdding(false);
    }
  }

  async function onRevoke(keyId: string) {
    setError(null);
    try {
      await api.revokeLlmKey(token, orgId, keyId);
      load();
    } catch (e) {
      setError(errMessage(e));
    }
  }

  async function onTest(keyId: string) {
    setTesting(keyId);
    setTestResult(null);
    try {
      const res = await api.testLlmKey(token, orgId, keyId);
      setTestResult({ id: keyId, ok: true, text: `${res.model}: ${res.reply}` });
    } catch (e) {
      setTestResult({ id: keyId, ok: false, text: errMessage(e) });
    } finally {
      setTesting(null);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-100">LLM Keys</h1>

      {canManage(user.role) && (
        <Panel>
          <h2 className="mb-3 text-sm font-medium text-slate-200">Add a key</h2>
          <form className="space-y-3" onSubmit={onAdd}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Label" value={label} onChange={(e) => setLabel(e.target.value)} required />
              <Field label="API key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required />
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-300">Provider</span>
                <select
                  value={provider}
                  onChange={(e) => selectProvider(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <Field label="Base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} required />
              <Field label="Chat model" value={chatModel} onChange={(e) => setChatModel(e.target.value)} required />
              <Field label="Embedding model" value={embedModel} onChange={(e) => setEmbedModel(e.target.value)} />
              <Field label="Embedding dimension" type="number" value={String(embedDim)} onChange={(e) => setEmbedDim(Number(e.target.value))} />
            </div>
            {addError && <ErrorNote message={addError} />}
            <Button type="submit" disabled={adding}>
              {adding ? "Adding…" : "Add key"}
            </Button>
          </form>
        </Panel>
      )}

      <Panel>
        <h2 className="mb-3 text-sm font-medium text-slate-200">Provider keys</h2>
        {error && <ErrorNote message={error} />}
        {!error && keys === null && <StatusLine>Loading keys…</StatusLine>}
        {keys !== null && keys.length === 0 && <StatusLine>No keys yet.</StatusLine>}
        {keys !== null && keys.length > 0 && (
          <ul className="divide-y divide-slate-800">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-100">{k.label}</p>
                  <p className="text-xs text-slate-500">{k.provider} · {k.chatModel}</p>
                  <p className="text-xs text-slate-500">{k.createdAt}</p>
                  {testResult && testResult.id === k.id && (
                    <p className={"mt-1 text-xs " + (testResult.ok ? "text-emerald-300" : "text-rose-300")}>
                      {testResult.text}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone="sky">{k.provider}</Badge>
                  {canManage(user.role) && (
                    <>
                      <Button variant="ghost" onClick={() => onTest(k.id)} disabled={testing !== null}>
                        {testing === k.id ? "Testing…" : "Test"}
                      </Button>
                      <Button variant="danger" onClick={() => onRevoke(k.id)}>
                        Revoke
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
