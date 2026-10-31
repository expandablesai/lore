// LlmKeys: list the organization's LLM provider keys and (for admins) add,
// revoke, and test them. The API key is write-only — it is never shown after
// the add form collects it once. A provider preset prefills the base URL and
// models; every field stays editable so any OpenAI-compatible endpoint works.
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
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
  visionModel?: string;
}

const PROVIDERS: ProviderPreset[] = [
  { id: "openai", label: "OpenAI", apiType: "openai", baseUrl: "https://api.openai.com/v1", chatModel: "gpt-4o", embedModel: "text-embedding-3-large", embedDim: 3072, visionModel: "gpt-4o" },
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
  const { t } = useI18n();
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
  const [visionModel, setVisionModel] = useState("gpt-4o");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; text: string; note?: string } | null>(null);
  const [models, setModels] = useState<{ id: string; list: string[] } | null>(null);

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
    setVisionModel(preset.visionModel ?? "");
  }

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    setAdding(true);
    setAddError(null);
    try {
      const preset = PROVIDERS.find((p) => p.id === provider);
      await api.addLlmKey(token, orgId, { label, apiKey, provider, apiType: preset?.apiType ?? "openai", baseUrl, chatModel, embedModel, embedDim, visionModel });
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

  /**
   * Switch a key on or off.
   *
   * A disabled key stops answering chat and stops embedding, without losing its
   * configuration — that is how the provider in use is chosen on the spot.
   */
  async function onToggle(key: OrgLlmKey) {
    setError(null);
    setKeys((prev) =>
      prev ? prev.map((k) => (k.id === key.id ? { ...k, enabled: !key.enabled } : k)) : prev,
    );
    try {
      await api.setLlmKeyEnabled(token, orgId, key.id, !key.enabled);
    } catch (e) {
      setError(errMessage(e));
      load();
    }
  }

  async function onTest(keyId: string) {
    setTesting(keyId);
    setTestResult(null);
    try {
      const res = await api.testLlmKey(token, orgId, keyId);
      // A key can be embedding-only; say which capability answered instead of
      // reporting a chat failure for a key that is working as configured.
      const text =
        res.mode === "embedding"
          ? `${res.model}: ${res.reply}`
          : `${res.model}: ${res.reply}`;
      setTestResult({ id: keyId, ok: true, text, note: res.note });
    } catch (e) {
      setTestResult({ id: keyId, ok: false, text: errMessage(e) });
    } finally {
      setTesting(null);
    }
  }

  async function onModels(keyId: string) {
    setError(null);
    setModels(null);
    try {
      const res = await api.llmKeyModels(token, orgId, keyId);
      setModels({ id: keyId, list: res.models });
    } catch (e) {
      setError(errMessage(e));
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-100">{t("LLM Keys")}</h1>

      {canManage(user.role) && (
        <Panel>
          <h2 className="mb-3 text-sm font-medium text-slate-200">{t("Add a key")}</h2>
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
              <Field
                label="Vision model (optional)"
                value={visionModel}
                onChange={(e) => setVisionModel(e.target.value)}
                placeholder="model id that reads images; blank uses the chat model"
              />
            </div>
            {addError && <ErrorNote message={addError} />}
            <Button type="submit" disabled={adding}>
              {adding ? "Adding…" : "Add key"}
            </Button>
          </form>
        </Panel>
      )}

      <Panel>
        <h2 className="mb-3 text-sm font-medium text-slate-200">{t("Provider keys")}</h2>
        {error && <ErrorNote message={error} />}
        {!error && keys === null && <StatusLine>Loading keys…</StatusLine>}
        {keys !== null && keys.length === 0 && <StatusLine>No keys yet.</StatusLine>}
        {keys !== null && keys.length > 0 && (
          <ul className="divide-y divide-slate-800">
            {keys.map((k) => (
              <li
                key={k.id}
                className={
                  "flex items-center justify-between gap-3 py-3 " + (k.enabled ? "" : "opacity-60")
                }
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-100">
                    {k.label}
                    {!k.enabled && <span className="ml-2 text-xs text-amber-300">disabled</span>}
                  </p>
                  <p className="text-xs text-slate-500">{k.provider} · {k.chatModel}</p>
                  <p className="text-xs text-slate-500">
                    {k.visionModel ? `vision: ${k.visionModel}` : "no vision model"} · {k.createdAt}
                  </p>
                  {testResult && testResult.id === k.id && (
                    <>
                      <p className={"mt-1 text-xs " + (testResult.ok ? "text-emerald-300" : "text-rose-300")}>
                        {testResult.text}
                      </p>
                      {testResult.note && (
                        <p className="mt-0.5 text-xs text-slate-500">{testResult.note}</p>
                      )}
                    </>
                  )}
                  {models && models.id === k.id && (
                    <p className="mt-1 text-xs text-slate-400">
                      {models.list.length > 0 ? models.list.join(", ") : "the provider listed no models"}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={k.enabled ? "sky" : "amber"}>{k.provider}</Badge>
                  {canManage(user.role) && (
                    <>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={k.enabled}
                        aria-label={`${k.enabled ? "Disable" : "Enable"} ${k.label}`}
                        onClick={() => void onToggle(k)}
                        className="flex items-center gap-2 rounded-full px-2 py-1 text-xs text-slate-400 transition hover:text-slate-200"
                      >
                        <span
                          aria-hidden="true"
                          className={
                            "relative h-4 w-8 rounded-full transition " +
                            (k.enabled ? "bg-emerald-500/80" : "bg-slate-700")
                          }
                        >
                          <span
                            className={
                              "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all " +
                              (k.enabled ? "left-4" : "left-0.5")
                            }
                          />
                        </span>
                      </button>
                      <Button variant="ghost" onClick={() => onTest(k.id)} disabled={testing !== null}>
                        {testing === k.id ? "Testing…" : "Test"}
                      </Button>
                      <Button variant="ghost" onClick={() => onModels(k.id)}>
                        Models
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
