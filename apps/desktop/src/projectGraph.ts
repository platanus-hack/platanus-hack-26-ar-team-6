/**
 * Project graph client. Calls the server's projection endpoint and returns
 * nodes/edges for the renderer to draw.
 */

export type GraphNodeKind = "agent" | "doc" | "event";
export type GraphEdgeKind = "authored" | "asked" | "provenance";

export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  label: string;
  meta: Record<string, unknown>;
};

export type GraphEdge = {
  source: string;
  target: string;
  kind: GraphEdgeKind;
  weight: number;
  meta: Record<string, unknown>;
};

export type ProjectGraphResponse = {
  project_id: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type LoadProjectGraphOptions = {
  serverBaseUrl: string;
  sessionToken: string;
  projectId: string;
  includeLocal?: boolean;
  maxDocs?: number;
  maxEvents?: number;
  maxExchanges?: number;
};

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return response.json() as Promise<T>;
}

export async function loadProjectGraph(
  opts: LoadProjectGraphOptions,
): Promise<ProjectGraphResponse> {
  const params = new URLSearchParams();
  if (opts.includeLocal) params.set("include_local", "true");
  if (opts.maxDocs) params.set("max_docs", String(opts.maxDocs));
  if (opts.maxEvents) params.set("max_events", String(opts.maxEvents));
  if (opts.maxExchanges) params.set("max_exchanges", String(opts.maxExchanges));
  const base = `${normalizeBaseUrl(opts.serverBaseUrl)}/projects/${opts.projectId}/graph`;
  const url = params.toString() ? `${base}?${params}` : base;
  return fetchJson<ProjectGraphResponse>(url, {
    headers: { Authorization: `Bearer ${opts.sessionToken}` },
  });
}
