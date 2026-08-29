import { HttpClient } from '../core/http-client';

export interface XpectrumKnowledgeConfig {
  /** Base URL of the Xpectrum API — the "API Server" value shown in the console */
  baseUrl: string;
  /** A **knowledge** API key (workspace-scoped) — not an app key */
  apiKey: string;
}

export interface KnowledgeSearchOptions {
  /** Max matches, 1–100. Defaults to 10. */
  limit?: number;
  signal?: AbortSignal;
}

/** One matching chunk from a knowledge base. */
export interface KnowledgeMatch {
  object?: 'match';
  score?: number;
  content?: string;
  document_id?: string;
  chunk_id?: string;
  position?: number;
}

export interface KnowledgeSearchResult {
  query: string;
  data: KnowledgeMatch[];
}

/**
 * XpectrumKnowledge — search a knowledge base directly.
 *
 * @example
 * ```ts
 * const kb = new XpectrumKnowledge({ baseUrl, apiKey: 'knowledge key' });
 * const { data } = await kb.search('<knowledge id>', 'refund policy');
 * ```
 */
export class XpectrumKnowledge {
  private http: HttpClient;

  constructor(config: XpectrumKnowledgeConfig) {
    this.http = new HttpClient({
      baseUrl: config.baseUrl,
      authMode: 'bearer',
      authValue: config.apiKey,
    });
  }

  /** Search one knowledge base and return the best-matching chunks. */
  async search(knowledgeId: string, query: string, options: KnowledgeSearchOptions = {}): Promise<KnowledgeSearchResult> {
    const raw = await this.http.post<{ query?: string; data?: KnowledgeMatch[] }>(
      `/knowledge/${knowledgeId}/search`,
      { query, limit: options.limit },
      { signal: options.signal },
    );
    return { query: raw.query ?? query, data: raw.data || [] };
  }
}
