// ─── Voice Configuration ────────────────────────────────────────────────────

export interface XpectrumVoiceConfig {
  /** URL of the Xpectrum voice server (FastAPI) */
  baseUrl: string;
  /** API key for authentication (x-api-key header) */
  apiKey: string;
  /** Agent name to connect to (e.g. 'my-sales-agent') */
  agentName: string;
}

// ─── Token Response ─────────────────────────────────────────────────────────
// Matches POST /tokens/generate response from FastAPI server

export interface TokenResponse {
  token: string;
  room_name: string;
  agent_name: string;
  unique_id: string;
  client_ip: string;
  participant_identity: string;
  participant_name: string;
  livekit_url: string;
  expires_in: string;
}

export type VoiceConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

// ─── Event Payloads ─────────────────────────────────────────────────────────

export interface TranscriptionSegment {
  id: string;
  text: string;
  isFinal: boolean;
  speaker: 'user' | 'agent';
}

export interface VoiceEventMap {
  connected: { roomName: string };
  disconnected: { reason: string };
  transcription: TranscriptionSegment;
  agentSpeaking: { isSpeaking: boolean };
  connectionStateChanged: { state: VoiceConnectionState };
  reconnecting: {};
  reconnected: {};
  error: { message: string; code?: string };
  microphoneChanged: { enabled: boolean };
}

// ─── Connect Callbacks ──────────────────────────────────────────────────────

export interface VoiceConnectCallbacks {
  onConnected?: (roomName: string) => void;
  onDisconnected?: (reason: string) => void;
  onTranscription?: (segment: TranscriptionSegment) => void;
  onAgentSpeaking?: (isSpeaking: boolean) => void;
  onConnectionStateChanged?: (state: VoiceConnectionState) => void;
  onReconnecting?: () => void;
  onReconnected?: () => void;
  onError?: (error: { message: string; code?: string }) => void;
}
