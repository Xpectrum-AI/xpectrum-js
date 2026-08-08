// ─── Core ────────────────────────────────────────────────────────────────────
export { HttpClient, XpectrumApiError } from './core/http-client';
export type { HttpClientConfig } from './core/http-client';
export { parseSSEStream } from './core/sse-parser';
export type { SSECallbacks } from './core/sse-parser';
export { EventEmitter } from './core/event-emitter';
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
  ChatFile,
  ChatOptions,
  StreamOptions,
  SendOptions,
  ChatResult,
  ChatUsage,
  ChatError,
  RetrieverResource,
  ModelInfo,
} from './chat/types';

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
