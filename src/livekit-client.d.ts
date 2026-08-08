/**
 * Type declaration stub for livekit-client peer dependency.
 * Users install this themselves: npm install livekit-client
 */
declare module 'livekit-client' {
  export class Room {
    constructor(options?: any);
    connect(url: string, token: string): Promise<void>;
    disconnect(stopTracks?: boolean): void;
    localParticipant: {
      identity: string;
      isMicrophoneEnabled: boolean;
      setMicrophoneEnabled(enabled: boolean): Promise<void>;
    };
    on(event: string, handler: (...args: any[]) => void): void;
    off(event: string, handler: (...args: any[]) => void): void;
  }

  export enum RoomEvent {
    TrackSubscribed = 'trackSubscribed',
    TrackUnsubscribed = 'trackUnsubscribed',
    ActiveSpeakersChanged = 'activeSpeakersChanged',
    TranscriptionReceived = 'transcriptionReceived',
    ConnectionStateChanged = 'connectionStateChanged',
    Reconnecting = 'reconnecting',
    Reconnected = 'reconnected',
    ParticipantDisconnected = 'participantDisconnected',
    Disconnected = 'disconnected',
  }

  export namespace Track {
    enum Kind {
      Audio = 'audio',
      Video = 'video',
    }
  }
}
