// ─── Core ────────────────────────────────────────────────────────────────────
export { HttpClient, XpectrumApiError } from './core/http-client';
export type { HttpClientConfig } from './core/http-client';
export { parseSSEStream } from './core/sse-parser';
export type { SSECallbacks } from './core/sse-parser';
export { EventEmitter } from './core/event-emitter';
/** Render an assistant reply's Markdown to safe HTML — useful when building your own UI. */
export { renderMarkdown } from './core/markdown';
export type {
  RequestOptions,
  ApiError,
  EventHandler,
  UnsubscribeFn,
} from './core/types';

// ─── Chat ────────────────────────────────────────────────────────────────────
export { XpectrumChat } from './chat/chat-client';
export type {
  XpectrumChatConfig,
  ChatMessage,
  ContentPart,
  Prompt,
  Attachment,
  AttachmentType,
  ChatOptions,
  StreamOptions,
  SendOptions,
  ChatResult,
  ChatUsage,
  ChatError,
  Citation,
  ModelInfo,
  // History
  Thread,
  ThreadMessage,
  ThreadListOptions,
  MessageListOptions,
  ListOptions,
  Page,
  // App config
  AgentInfo,
} from './chat/types';

// ─── Workflow ────────────────────────────────────────────────────────────────
export { XpectrumWorkflow } from './workflow/workflow-client';
export type {
  XpectrumWorkflowConfig,
  RunOptions,
  RunStreamOptions,
  Run,
  RunStarted,
  RunStatus,
  Step,
} from './workflow/types';

// ─── Knowledge ───────────────────────────────────────────────────────────────
export { XpectrumKnowledge } from './knowledge/knowledge-client';
export type {
  XpectrumKnowledgeConfig,
  KnowledgeSearchOptions,
  KnowledgeMatch,
  KnowledgeSearchResult,
} from './knowledge/knowledge-client';

// ─── Voice ───────────────────────────────────────────────────────────────────
export { XpectrumVoice } from './voice/voice-client';
export type {
  XpectrumVoiceConfig,
  TokenResponse,
  VoiceConnectionState,
  VoiceEventMap,
  VoiceConnectCallbacks,
  TranscriptionSegment,
} from './voice/types';

// ─── Widgets (optional pre-built UI) ────────────────────────────────────────
export { ChatWidget } from './widgets/chat-widget';
export type { ChatWidgetConfig } from './widgets/chat-widget';

export { VoiceWidget } from './widgets/voice-widget';
export type { VoiceWidgetConfig } from './widgets/voice-widget';

export { OmnichannelWidget } from './widgets/omnichannel-widget';
export type { OmnichannelWidgetConfig } from './widgets/omnichannel-widget';
