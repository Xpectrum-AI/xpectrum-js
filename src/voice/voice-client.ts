import { HttpClient } from '../core/http-client';
import { EventEmitter } from '../core/event-emitter';
import type {
  XpectrumVoiceConfig,
  TokenResponse,
  VoiceConnectionState,
  VoiceEventMap,
  VoiceConnectCallbacks,
  TranscriptionSegment,
} from './types';

type LiveKitRoom = any;
type LiveKitTrack = any;

/**
 * XpectrumVoice — Real-time voice client for Xpectrum AI agents.
 *
 * Connects to the Xpectrum voice server (FastAPI), acquires a LiveKit token,
 * and manages the WebRTC voice call lifecycle.
 *
 * Requires `livekit-client` as a peer dependency:
 * ```bash
 * npm install livekit-client
 * ```
 *
 * @example
 * ```ts
 * const voice = new XpectrumVoice({
 *   baseUrl: 'https://voice.yourserver.com',
 *   apiKey: 'xpectrum_ai_sk_...',
 *   agentName: 'my-sales-agent',
 * });
 *
 * await voice.connect({
 *   onConnected: (roomName) => console.log('Connected:', roomName),
 *   onTranscription: (seg) => console.log(seg.speaker + ':', seg.text),
 *   onDisconnected: (reason) => console.log('Ended:', reason),
 * });
 * ```
 */
export class XpectrumVoice extends EventEmitter<VoiceEventMap> {
  private http: HttpClient;
  private config: XpectrumVoiceConfig;
  private room: LiveKitRoom | null = null;
  private roomName: string | null = null;
  private connectionState: VoiceConnectionState = 'disconnected';
  private livekit: typeof import('livekit-client') | null = null;
  private audioElements: HTMLAudioElement[] = [];

  constructor(config: XpectrumVoiceConfig) {
    super();
    this.config = config;
    this.http = new HttpClient({
      baseUrl: config.baseUrl,
      authMode: 'api-key',
      authValue: config.apiKey,
    });
  }

  // ─── Connection ─────────────────────────────────────────────────────────

  /**
   * Start a voice call.
   *
   * 1. Calls POST /tokens/generate?agent_name=xxx to get a LiveKit token
   * 2. Connects to the LiveKit room via WebRTC
   * 3. Enables the microphone
   * 4. Listens for agent audio, transcription, and connection events
   */
  async connect(callbacks?: VoiceConnectCallbacks): Promise<void> {
    if (this.connectionState === 'connected' || this.connectionState === 'connecting') {
      throw new Error('Already connected or connecting. Call disconnect() first.');
    }

    this.setConnectionState('connecting');

    if (callbacks) {
      this.registerCallbacks(callbacks);
    }

    try {
      // Dynamically import livekit-client (peer dependency)
      if (!this.livekit) {
        try {
          this.livekit = await import('livekit-client');
        } catch {
          throw new Error(
            'livekit-client is required for voice calls. Install it: npm install livekit-client',
          );
        }
      }

      // Step 1: Get LiveKit token from voice server
      const tokenData = await this.http.post<TokenResponse>(
        '/tokens/generate',
        null,
        { params: { agent_name: this.config.agentName } },
      );

      this.roomName = tokenData.room_name;

      // Step 2: Create LiveKit room with audio processing
      const { Room, RoomEvent, Track } = this.livekit;
      this.room = new Room({
        audioCaptureDefaults: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
        publishDefaults: {
          audioPreset: { maxBitrate: 32_000 },
        },
      });

      this.setupRoomListeners(this.room, RoomEvent, Track);

      // Step 3: Connect to LiveKit room
      await this.room.connect(tokenData.livekit_url, tokenData.token);

      // Step 4: Enable microphone
      await this.room.localParticipant.setMicrophoneEnabled(true);

      this.setConnectionState('connected');
      this.emit('connected', { roomName: this.roomName });
    } catch (error: any) {
      this.setConnectionState('failed');
      this.emit('error', { message: error.message || 'Failed to connect' });
      throw error;
    }
  }

  /**
   * End the voice call.
   *
   * Disconnects the LiveKit room and notifies the server via
   * POST /call-control/end-call.
   */
  async disconnect(): Promise<void> {
    const roomName = this.roomName;

    if (this.room) {
      try {
        this.room.disconnect(true);
      } catch {
        // Ignore
      }
      this.room = null;
    }

    // Clean up audio elements
    for (const el of this.audioElements) {
      el.pause();
      el.srcObject = null;
      el.remove();
    }
    this.audioElements = [];

    // Tell the server the call is over
    if (roomName) {
      try {
        await this.http.post('/call-control/end-call', {
          room_name: roomName,
          reason: 'User hung up',
        });
      } catch {
        // Best-effort
      }
    }

    this.roomName = null;
    this.setConnectionState('disconnected');
    this.emit('disconnected', { reason: 'user_initiated' });
  }

  // ─── Microphone Control ─────────────────────────────────────────────────

  async setMicEnabled(enabled: boolean): Promise<void> {
    if (!this.room?.localParticipant) {
      throw new Error('Not connected to a voice room');
    }
    await this.room.localParticipant.setMicrophoneEnabled(enabled);
    this.emit('microphoneChanged', { enabled });
  }

  isMicEnabled(): boolean {
    return this.room?.localParticipant?.isMicrophoneEnabled ?? false;
  }

  // ─── State Getters ──────────────────────────────────────────────────────

  getConnectionState(): VoiceConnectionState {
    return this.connectionState;
  }

  getRoomName(): string | null {
    return this.roomName;
  }

  isConnected(): boolean {
    return this.connectionState === 'connected';
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────

  destroy(): void {
    this.disconnect().catch(() => {});
    this.removeAllListeners();
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private setConnectionState(state: VoiceConnectionState): void {
    this.connectionState = state;
    this.emit('connectionStateChanged', { state });
  }

  private registerCallbacks(callbacks: VoiceConnectCallbacks): void {
    if (callbacks.onConnected)
      this.on('connected', (d) => callbacks.onConnected!(d.roomName));
    if (callbacks.onDisconnected)
      this.on('disconnected', (d) => callbacks.onDisconnected!(d.reason));
    if (callbacks.onTranscription)
      this.on('transcription', (d) => callbacks.onTranscription!(d));
    if (callbacks.onAgentSpeaking)
      this.on('agentSpeaking', (d) => callbacks.onAgentSpeaking!(d.isSpeaking));
    if (callbacks.onConnectionStateChanged)
      this.on('connectionStateChanged', (d) => callbacks.onConnectionStateChanged!(d.state));
    if (callbacks.onReconnecting)
      this.on('reconnecting', () => callbacks.onReconnecting!());
    if (callbacks.onReconnected)
      this.on('reconnected', () => callbacks.onReconnected!());
    if (callbacks.onError)
      this.on('error', (d) => callbacks.onError!(d));
  }

  private setupRoomListeners(room: LiveKitRoom, RoomEvent: any, Track: any): void {
    // Agent audio tracks
    room.on(RoomEvent.TrackSubscribed, (track: LiveKitTrack, _pub: any, _participant: any) => {
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach() as HTMLAudioElement;
        el.setAttribute('data-xpectrum-voice', 'agent-audio');
        document.body.appendChild(el);
        this.audioElements.push(el);
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track: LiveKitTrack) => {
      const elements = track.detach() as HTMLMediaElement[];
      for (const el of elements) {
        el.remove();
        const idx = this.audioElements.indexOf(el as HTMLAudioElement);
        if (idx !== -1) this.audioElements.splice(idx, 1);
      }
    });

    // Agent speaking detection
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers: any[]) => {
      const agentSpeaking = speakers.some(
        (s: any) => s.identity !== room.localParticipant?.identity,
      );
      this.emit('agentSpeaking', { isSpeaking: agentSpeaking });
    });

    // Real-time transcription
    room.on(RoomEvent.TranscriptionReceived, (segments: any[], participant: any) => {
      const isAgent = participant?.identity !== room.localParticipant?.identity;
      for (const segment of segments) {
        const transcription: TranscriptionSegment = {
          id: segment.id || '',
          text: segment.text || '',
          isFinal: segment.final ?? false,
          speaker: isAgent ? 'agent' : 'user',
        };
        this.emit('transcription', transcription);
      }
    });

    room.on(RoomEvent.Reconnecting, () => {
      this.setConnectionState('reconnecting');
      this.emit('reconnecting', {});
    });

    room.on(RoomEvent.Reconnected, () => {
      this.setConnectionState('connected');
      this.emit('reconnected', {});
    });

    room.on(RoomEvent.ParticipantDisconnected, (participant: any) => {
      if (participant.identity !== room.localParticipant?.identity) {
        this.emit('disconnected', { reason: 'agent_disconnected' });
      }
    });

    room.on(RoomEvent.Disconnected, (reason: string) => {
      this.setConnectionState('disconnected');
      this.emit('disconnected', { reason: reason || 'room_closed' });
    });
  }
}
