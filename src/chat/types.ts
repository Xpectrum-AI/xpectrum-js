// ─── Chat Configuration ─────────────────────────────────────────────────────

export interface XpectrumChatConfig {
  /** Base URL of the Xpectrum API — the "API Server" value shown in the console */
  baseUrl: string;
  /** API key — used as Bearer token for all requests */
  apiKey: string;
  /** Model name sent with each request. Informational only — the API key selects the app. */
  model?: string;
  /** Optional user identifier — each unique user gets their own conversation history */
  user?: string;
  /** Default input variables to send with every request */
  inputs?: Record<string, any>;
}

// ─── Messages ───────────────────────────────────────────────────────────────

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

/** A prompt is either a bare string (sent as one user message) or a full message array. */
export type Prompt = string | ChatMessage[];

export interface ChatFile {
  type: 'image';
  transfer_method: 'remote_url' | 'local_file';
  url?: string;
  upload_file_id?: string;
}

// ─── Request Options ────────────────────────────────────────────────────────

export interface ChatOptions {
  /** Continue an existing conversation. History is kept server-side — no need to resend it. */
  conversationId?: string;
  inputs?: Record<string, any>;
  files?: ChatFile[];
  channel?: string;
  channelMetadata?: Record<string, any>;
  /** IANA timezone, e.g. 'Asia/Kolkata' */
  timezone?: string;
  /** Overrides the configured model name for this call. */
  model?: string;
  signal?: AbortSignal;
  getAbortController?: (controller: AbortController) => void;
}

export interface StreamOptions extends ChatOptions {
  /** Fired per token. `delta` is the new text, `full` is everything received so far. */
  onToken?: (delta: string, full: string) => void;
  onDone?: (result: ChatResult) => void;
  onError?: (error: ChatError) => void;
}

export interface SendOptions extends ChatOptions {
  /**
   * Send a single non-streaming request instead of streaming and aggregating.
   * Slightly cheaper, but the API rejects blocking mode for agent apps — leave
   * this off unless you know the app is a chatbot or chatflow.
   */
  blocking?: boolean;
}

// ─── Responses ──────────────────────────────────────────────────────────────

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface RetrieverResource {
  position: number;
  dataset_id?: string;
  dataset_name?: string;
  document_id?: string;
  document_name?: string;
  segment_id?: string;
  score?: number;
  content?: string;
}

export interface ChatResult {
  /** The assistant's full reply. */
  content: string;
  model?: string;
  /** Pass into a later call to continue the same conversation. */
  conversationId?: string;
  messageId?: string;
  taskId?: string;
  usage?: ChatUsage;
  /** Knowledge-base citations, when the app has retrieval enabled. */
  retrieverResources?: RetrieverResource[];
  finishReason?: string;
}

export interface ChatError {
  message: string;
  code?: string;
  status?: number;
}

export interface ModelInfo {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

// ─── Wire formats (internal) ────────────────────────────────────────────────

export interface RawStreamChunk {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  conversation_id?: string;
  task_id?: string;
  choices?: Array<{
    index: number;
    delta: { role?: string; content?: string };
    finish_reason: string | null;
  }>;
  usage?: ChatUsage;
  retriever_resources?: RetrieverResource[];
  error?: { message?: string; type?: string; code?: string };
}

export interface RawCompletion {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  conversation_id?: string;
  task_id?: string;
  mode?: string;
  choices?: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string | null;
  }>;
  usage?: ChatUsage;
  retriever_resources?: RetrieverResource[];
}

export interface ModelListResponse {
  object: string;
  data: ModelInfo[];
}
