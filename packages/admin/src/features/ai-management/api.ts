import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../shared/api/apiClient";

export type AiKind = "llm" | "image";
export type AiProvider =
  "openai-compatible" | "openai" | "spicyapi" | "fal" | "opod-flux";
export type Binding = { connectionId: string; modelId: string };
export type Connection = {
  id: string;
  type: AiKind;
  provider: AiProvider;
  apiUrl: string;
  apiKey: { set: boolean; last4?: string };
  configured: boolean;
  models: { id: string; model: string }[];
};
export type Feature = {
  id: string;
  group: string;
  label: string;
  description: string;
  type: AiKind;
  selection: (Binding & { provider: AiProvider; model: string }) | null;
};
export type AiConfig = {
  revision: string | null;
  connections: Connection[];
  features: Feature[];
  changes: { at: string; actor: string; summary: string }[];
};
export type ConnectionInput = Pick<
  Connection,
  "type" | "provider" | "apiUrl"
> & { apiKey?: string };
export type ProbeInput = { apiUrl?: string; apiKey?: string; modelId?: string };
export type ProbeResult = {
  ok: boolean;
  message: string;
  scope: "connection" | "model";
  checkedAt: string;
};
const ROOT = "/ai-management";
const key = ["ai-management"];
export const fetchAiConfig = () => apiRequest<AiConfig>(ROOT);
export const useAiConfig = () =>
  useQuery({ queryKey: key, queryFn: fetchAiConfig });
export function useAiChange() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (change: () => Promise<AiConfig>) => change(),
    onSuccess: (config) => {
      cache.setQueryData(key, config);
      void cache.invalidateQueries({ queryKey: ["post-agent-models"] });
    },
    onError: () => {
      void cache.invalidateQueries({ queryKey: key });
    },
  });
}
export const saveConnection = (
  id: string | null,
  input: ConnectionInput,
  expectedRevision: string | null,
) =>
  apiRequest<AiConfig>(
    `${ROOT}/connections${id ? `/${encodeURIComponent(id)}` : ""}`,
    { method: id ? "PUT" : "POST", body: { ...input, expectedRevision } },
  );
export const removeConnection = (id: string, expectedRevision: string | null) =>
  apiRequest<AiConfig>(`${ROOT}/connections/${encodeURIComponent(id)}`, {
    method: "DELETE",
    body: { expectedRevision },
  });
export const addModel = (
  id: string,
  model: string,
  expectedRevision: string | null,
) =>
  apiRequest<AiConfig>(`${ROOT}/connections/${encodeURIComponent(id)}/models`, {
    method: "POST",
    body: { model, expectedRevision },
  });
export const removeModel = (
  id: string,
  modelId: string,
  expectedRevision: string | null,
) =>
  apiRequest<AiConfig>(
    `${ROOT}/connections/${encodeURIComponent(id)}/models/${encodeURIComponent(modelId)}`,
    { method: "DELETE", body: { expectedRevision } },
  );
export const assignModel = (
  featureId: string,
  binding: Binding,
  expectedRevision: string | null,
) =>
  apiRequest<AiConfig>(`${ROOT}/features/${encodeURIComponent(featureId)}`, {
    method: "PUT",
    body: {
      connectionId: binding.connectionId,
      modelId: binding.modelId,
      expectedRevision,
    },
  });
export const testConnection = (id: string, body: ProbeInput) =>
  apiRequest<ProbeResult>(
    `${ROOT}/connections/${encodeURIComponent(id)}/test`,
    { method: "POST", body },
  );
export const discoverModels = (id: string, body: ProbeInput) =>
  apiRequest<{ items: string[] }>(
    `${ROOT}/connections/${encodeURIComponent(id)}/discover-models`,
    { method: "POST", body },
  );
export const PROVIDERS: Record<AiProvider, string> = {
  "openai-compatible": "OpenAI 호환",
  openai: "OpenAI",
  spicyapi: "SpicyAPI",
  fal: "fal",
  "opod-flux": "OPOD Flux",
};
