// ─── Chat Configuration ─────────────────────────────────────────────────────

export interface XpectrumChatConfig {
  /** Base URL of the Xpectrum API — the "API Server" value shown in the console */
  baseUrl: string;
  /** API key — used as Bearer token for all requests */
  apiKey: string;
  /** Model name sent with each request. Informational only — the API key selects the agent. */
  model?: string;
  /**
   * Who this conversation belongs to. Each unique value gets its own history.
   *
   * Omit it and the SDK issues a random anonymous id, stored per browser, so a
   * visitor keeps their history without logging in. Set it from your own
   * authenticated session once they do — never from something the browser sent
   * you, or one user could read another's history.
   */
  user?: string;
  /**
   * How long an auto-generated anonymous id survives, in days. Defaults to 30.
   * The clock resets on every use, so an active visitor is never forgotten.
   * Ignored when `user` is supplied.
   */
  anonymousTtlDays?: number;
  /** Default variables to send with every request */
  variables?: Record<string, any>;
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

export type AttachmentType = 'image' | 'document' | 'audio' | 'video' | 'custom';

/**
 * A file sent with a message — either fetched from a URL or one previously
 * uploaded (by its `file_id`). Exactly one of `url` / `file_id` is required.
 */
export type Attachment =
  | { type: AttachmentType; url: string; file_id?: never }
  | { type: AttachmentType; file_id: string; url?: never };

// ─── Request Options ────────────────────────────────────────────────────────

export interface ChatOptions {
  /** Continue an existing thread. History is kept server-side — no need to resend it. */
  threadId?: string;
  /** Input variables for this call. Merged over the configured defaults. */
  variables?: Record<string, any>;
  attachments?: Attachment[];
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
   * this off unless you know the app is a chatbot or flow.
   */
  blocking?: boolean;
}

// ─── Responses ──────────────────────────────────────────────────────────────

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** A knowledge-base chunk the reply drew on. */
export interface Citation {
  object?: 'citation';
  knowledge_id?: string;
  knowledge_name?: string;
  document_id?: string;
  document_name?: string;
  chunk_id?: string;
  content?: string;
  score?: number;
  position?: number;
}

/** App type behind the API key. */
export type AgentMode = 'chatbot' | 'agent' | 'flow' | 'workflow' | 'completion';

export interface ChatResult {
  /** The assistant's full reply. */
  content: string;
  model?: string;
  /** Pass into a later call to continue the same thread. */
  threadId?: string;
  /** Id of the assistant message — pass to `getSuggestions()`. */
  messageId?: string;
  /** Pass to `cancel()` to stop generation server-side. */
  runId?: string;
  mode?: AgentMode;
  usage?: ChatUsage;
  /** Knowledge-base citations, when the agent has retrieval enabled. */
  citations?: Citation[];
  finishReason?: string;
}

export interface ChatError {
  message: string;
  code?: string;
  status?: number;
}

/**
 * The single entry of `GET /models`. An API key reaches exactly one agent, so
 * besides the OpenAI model fields it describes that agent.
 */
export interface ModelInfo {
  /** The agent id — also the `model` value in chat responses. */
  id: string;
  object: string;
  created: number;
  owned_by: string;
  name?: string;
  description?: string;
  mode?: AgentMode;
  title?: string;
  greeting?: string;
  starter_questions?: string[];
}

/** Everything a client needs to introduce the agent before the first message. */
export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  mode?: AgentMode;
  /** Header title configured in the console (falls back to `name`). */
  title: string;
  /** The opening message, configured in the console. */
  greeting?: string;
  /** Suggested prompts to show alongside the greeting. */
  starterQuestions: string[];
}

/** Follow-up questions generated from a thread so far. */
export interface Suggestions {
  messageId: string;
  questions: string[];
}

// ─── History ────────────────────────────────────────────────────────────────

/** A past conversation. Titles are generated server-side from the contents. */
export interface Thread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface ThreadMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  citations?: Citation[];
  /** Set when the reply failed — explains an empty `content`. */
  error?: string;
}

export interface ListOptions {
  /** Page size, 1–100. Defaults to 20. */
  limit?: number;
  signal?: AbortSignal;
}

export interface ThreadListOptions extends ListOptions {
  /** Pass the previous page's `lastId` to fetch older threads. */
  after?: string;
}

export interface MessageListOptions extends ListOptions {
  /** Pass the previous page's `firstId` to walk further back. */
  before?: string;
}

export interface Page<T> {
  data: T[];
  hasMore: boolean;
  limit: number;
  /** Cursors address stored rows — pass these back, not ids from `data`. */
  firstId?: string;
  lastId?: string;
}

// ─── Wire formats (internal) ────────────────────────────────────────────────

export interface RawThread {
  id: string;
  object?: string;
  title?: string;
  created_at?: number;
  updated_at?: number;
}

export interface RawThreadMessage {
  id: string;
  object?: string;
  thread_id?: string;
  role?: 'user' | 'assistant';
  content?: string;
  created_at?: number;
  citations?: Citation[];
  error?: string;
}

export interface RawPage<T> {
  object?: string;
  data?: T[];
  has_more?: boolean;
  limit?: number;
  first_id?: string | null;
  last_id?: string | null;
}

export interface RawStreamChunk {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  thread_id?: string;
  run_id?: string;
  choices?: Array<{
    index: number;
    delta: { role?: string; content?: string };
    finish_reason: string | null;
  }>;
  usage?: ChatUsage;
  citations?: Citation[];
  error?: { message?: string; type?: string; code?: string };
}

export interface RawCompletion {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  thread_id?: string;
  run_id?: string;
  mode?: AgentMode;
  choices?: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string | null;
  }>;
  usage?: ChatUsage;
  citations?: Citation[];
}

export interface RawSuggestions {
  object?: string;
  message_id?: string;
  data?: string[];
}

export interface ModelListResponse {
  object: string;
  data: ModelInfo[];
}
