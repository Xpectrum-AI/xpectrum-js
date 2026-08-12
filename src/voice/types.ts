// ─── Voice Configuration ────────────────────────────────────────────────────

export interface XpectrumVoiceConfig {
  /** Xpectrum API base URL — same one used for chat (e.g. 'https://app.yourserver.com/v1') */
  baseUrl: string;
  /** Your app's API key. The voice agent is determined by this key. */
  apiKey: string;
  /** @deprecated No longer used — the voice agent is determined by the API key. */
  agentName?: string;
}

// ─── Token Response ─────────────────────────────────────────────────────────
// Matches the POST /voice/tokens/generate response

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
  /** The agent's live audio stream — for visualizers (waveforms, orbs). */
  agentAudio: { stream: MediaStream };
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
  /** Fired when the agent's audio starts — the stream feeds visualizers. */
  onAgentAudio?: (stream: MediaStream) => void;
  onConnectionStateChanged?: (state: VoiceConnectionState) => void;
  onReconnecting?: () => void;
  onReconnected?: () => void;
  onError?: (error: { message: string; code?: string }) => void;
}
