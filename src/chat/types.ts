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
  citations?: RetrieverResource[];
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

// ─── App config ─────────────────────────────────────────────────────────────

export interface AppFeatures {
  speechToText: boolean;
  textToSpeech: boolean;
  fileUpload: boolean;
  citations: boolean;
  suggestedQuestionsAfterAnswer: boolean;
}

export interface AppAppearance {
  title?: string;
  icon?: string;
  iconBackground?: string;
  defaultLanguage?: string;
  copyright?: string;
  privacyPolicy?: string;
  customDisclaimer?: string;
}

/** Everything needed to render a client, in one call. */
export interface AppConfig {
  name?: string;
  description?: string;
  /** The opening message, configured in the console. */
  greeting?: string;
  /** Suggested prompts to show alongside the greeting. */
  starterQuestions: string[];
  inputFields: Array<Record<string, any>>;
  features: AppFeatures;
  limits?: Record<string, any>;
  appearance?: AppAppearance;
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
  citations?: RetrieverResource[];
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

export interface RawAppConfig {
  object?: string;
  name?: string;
  description?: string;
  greeting?: string;
  starter_questions?: string[];
  input_fields?: Array<Record<string, any>>;
  features?: {
    speech_to_text?: boolean;
    text_to_speech?: boolean;
    file_upload?: boolean;
    citations?: boolean;
    suggested_questions_after_answer?: boolean;
  };
  limits?: Record<string, any>;
  appearance?: {
    title?: string;
    icon?: string;
    icon_background?: string;
    default_language?: string;
    copyright?: string;
    privacy_policy?: string;
    custom_disclaimer?: string;
  };
}

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
