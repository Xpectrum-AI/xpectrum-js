import { XpectrumVoice } from '../voice/voice-client';
import type { TranscriptionSegment, VoiceConnectionState } from '../voice/types';

export interface VoiceWidgetConfig {
  /** Your app's API key — the voice agent is determined by this key */
  apiKey: string;
  /** @deprecated No longer used — the voice agent is determined by the API key. */
  agentName?: string;
  /** Xpectrum API base URL — same one used for chat (e.g. 'https://app.yourserver.com/v1') */
  baseUrl: string;
  /** Container element to mount into (defaults to document.body) */
  container?: HTMLElement;
  /** Widget position */
  position?: 'bottom-right' | 'bottom-left';
  /** Trigger button background color */
  buttonColor?: string;
  /** Trigger button size in px */
  buttonSize?: number;
  /** z-index for the widget */
  zIndex?: number;
  /** Window width in px */
  windowWidth?: number;
  /** Window height in px */
  windowHeight?: number;
  /** Called for each transcription segment */
  onTranscription?: (segment: TranscriptionSegment) => void;
  /** Called on connection state changes */
  onStateChange?: (state: VoiceConnectionState) => void;
}

const DEFAULT_CONFIG: Partial<VoiceWidgetConfig> = {
  position: 'bottom-right',
  buttonColor: '#7C3AED',
  buttonSize: 48,
  zIndex: 2147483647,
  windowWidth: 360,
  windowHeight: 480,
};

/**
 * VoiceWidget — Drop-in embeddable voice call button.
 *
 * Renders a floating phone button that opens a voice call panel
 * with microphone controls and real-time transcription.
 */
export class VoiceWidget {
  private config: Required<Pick<VoiceWidgetConfig, 'apiKey' | 'baseUrl'>> & VoiceWidgetConfig;
  private voice: XpectrumVoice;
  private container: HTMLElement;
  private buttonEl: HTMLElement | null = null;
  private windowEl: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private isOpen = false;
  private state: VoiceConnectionState = 'disconnected';
  private transcriptions: Array<{ speaker: string; text: string; id: string }> = [];
  private isMuted = false;

  constructor(config: VoiceWidgetConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config } as any;
    this.container = config.container || document.body;
    this.voice = new XpectrumVoice({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
    });
    this.mount();
  }

  open(): void {
    if (!this.windowEl) return;
    this.windowEl.style.display = 'flex';
    this.isOpen = true;
    this.updateButtonIcon();
  }

  close(): void {
    if (!this.windowEl) return;
    this.windowEl.style.display = 'none';
    this.isOpen = false;
    this.updateButtonIcon();
    // Disconnect if call is active
    if (this.state === 'connected' || this.state === 'connecting') {
      this.hangUp();
    }
  }

  toggle(): void {
    this.isOpen ? this.close() : this.open();
  }

  destroy(): void {
    this.voice.destroy();
    const host = this.container.querySelector('#xpectrum-voice-widget-host');
    if (host) host.remove();
  }

  // ─── Private: Mount ─────────────────────────────────────────────────────

  private mount(): void {
    const host = document.createElement('div');
    host.id = 'xpectrum-voice-widget-host';
    this.container.appendChild(host);
    this.shadowRoot = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = this.getStyles();
    this.shadowRoot.appendChild(style);

    this.buttonEl = this.createButton();
    this.shadowRoot.appendChild(this.buttonEl);

    this.windowEl = this.createWindow();
    this.shadowRoot.appendChild(this.windowEl);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
  }

  private createButton(): HTMLElement {
    const btn = document.createElement('div');
    btn.className = 'xp-voice-button';
    btn.innerHTML = this.getPhoneIcon();
    btn.addEventListener('click', () => this.toggle());
    return btn;
  }

  private createWindow(): HTMLElement {
    const win = document.createElement('div');
    win.className = 'xp-voice-window';
    win.style.display = 'none';

    win.innerHTML = `
      <div class="xp-voice-header">
        <span class="xp-voice-title">Voice Call</span>
        <button class="xp-voice-close-btn">${this.getCloseIcon()}</button>
      </div>
      <div class="xp-voice-status">
        <div class="xp-voice-status-indicator"></div>
        <span class="xp-voice-status-text">Ready to call</span>
      </div>
      <div class="xp-voice-transcription"></div>
      <div class="xp-voice-controls">
        <button class="xp-voice-mute-btn" title="Toggle microphone">${this.getMicIcon()}</button>
        <button class="xp-voice-call-btn" title="Start call">${this.getPhoneIcon()}</button>
        <button class="xp-voice-hangup-btn" title="End call" style="display:none">${this.getHangupIcon()}</button>
      </div>
    `;

    win.querySelector('.xp-voice-close-btn')?.addEventListener('click', () => this.close());
    win.querySelector('.xp-voice-call-btn')?.addEventListener('click', () => this.startCall());
    win.querySelector('.xp-voice-hangup-btn')?.addEventListener('click', () => this.hangUp());
    win.querySelector('.xp-voice-mute-btn')?.addEventListener('click', () => this.toggleMute());

    return win;
  }

  // ─── Private: Call Control ──────────────────────────────────────────────

  private async startCall(): Promise<void> {
    this.updateState('connecting');
    this.transcriptions = [];
    this.renderTranscriptions();

    try {
      await this.voice.connect({
        onConnected: (roomName) => {
          this.updateState('connected');
        },
        onTranscription: (segment) => {
          this.handleTranscription(segment);
          this.config.onTranscription?.(segment);
        },
        onAgentSpeaking: (isSpeaking) => {
          this.updateAgentSpeaking(isSpeaking);
        },
        onDisconnected: (reason) => {
          this.updateState('disconnected');
        },
        onReconnecting: () => {
          this.updateState('reconnecting');
        },
        onReconnected: () => {
          this.updateState('connected');
        },
        onError: (error) => {
          this.updateState('failed');
          this.updateStatusText(`Error: ${error.message}`);
        },
      });
    } catch (error: any) {
      this.updateState('failed');
      this.updateStatusText(`Failed to connect: ${error.message}`);
    }
  }

  private async hangUp(): Promise<void> {
    await this.voice.disconnect();
    this.updateState('disconnected');
  }

  private async toggleMute(): Promise<void> {
    this.isMuted = !this.isMuted;
    await this.voice.setMicEnabled(!this.isMuted);
    this.updateMuteButton();
  }

  // ─── Private: Transcription ─────────────────────────────────────────────

  private handleTranscription(segment: TranscriptionSegment): void {
    const existing = this.transcriptions.find((t) => t.id === segment.id);
    if (existing) {
      existing.text = segment.text;
    } else {
      this.transcriptions.push({
        id: segment.id,
        speaker: segment.speaker,
        text: segment.text,
      });
    }
    // Keep only last 50 transcriptions
    if (this.transcriptions.length > 50) {
      this.transcriptions = this.transcriptions.slice(-50);
    }
    this.renderTranscriptions();
  }

  private renderTranscriptions(): void {
    const container = this.windowEl?.querySelector('.xp-voice-transcription');
    if (!container) return;

    container.innerHTML = this.transcriptions
      .map(
        (t) => `
      <div class="xp-trans xp-trans-${t.speaker}">
        <span class="xp-trans-speaker">${t.speaker === 'user' ? 'You' : 'Agent'}</span>
        <span class="xp-trans-text">${this.escapeHtml(t.text)}</span>
      </div>
    `,
      )
      .join('');

    container.scrollTop = container.scrollHeight;
  }

  // ─── Private: UI Updates ────────────────────────────────────────────────

  private updateState(state: VoiceConnectionState): void {
    this.state = state;
    this.config.onStateChange?.(state);

    const statusIndicator = this.windowEl?.querySelector('.xp-voice-status-indicator') as HTMLElement;
    const callBtn = this.windowEl?.querySelector('.xp-voice-call-btn') as HTMLElement;
    const hangupBtn = this.windowEl?.querySelector('.xp-voice-hangup-btn') as HTMLElement;
    const muteBtn = this.windowEl?.querySelector('.xp-voice-mute-btn') as HTMLElement;

    switch (state) {
      case 'disconnected':
        this.updateStatusText('Ready to call');
        if (statusIndicator) statusIndicator.style.background = '#9ca3af';
        if (callBtn) callBtn.style.display = 'flex';
        if (hangupBtn) hangupBtn.style.display = 'none';
        if (muteBtn) muteBtn.style.display = 'none';
        break;
      case 'connecting':
        this.updateStatusText('Connecting...');
        if (statusIndicator) statusIndicator.style.background = '#f59e0b';
        if (callBtn) callBtn.style.display = 'none';
        if (hangupBtn) hangupBtn.style.display = 'flex';
        if (muteBtn) muteBtn.style.display = 'none';
        break;
      case 'connected':
        this.updateStatusText('Connected');
        if (statusIndicator) statusIndicator.style.background = '#10b981';
        if (callBtn) callBtn.style.display = 'none';
        if (hangupBtn) hangupBtn.style.display = 'flex';
        if (muteBtn) muteBtn.style.display = 'flex';
        break;
      case 'reconnecting':
        this.updateStatusText('Reconnecting...');
        if (statusIndicator) statusIndicator.style.background = '#f59e0b';
        break;
      case 'failed':
        this.updateStatusText('Connection failed');
        if (statusIndicator) statusIndicator.style.background = '#ef4444';
        if (callBtn) callBtn.style.display = 'flex';
        if (hangupBtn) hangupBtn.style.display = 'none';
        if (muteBtn) muteBtn.style.display = 'none';
        break;
    }
  }

  private updateStatusText(text: string): void {
    const el = this.windowEl?.querySelector('.xp-voice-status-text');
    if (el) el.textContent = text;
  }

  private updateAgentSpeaking(isSpeaking: boolean): void {
    if (this.state !== 'connected') return;
    this.updateStatusText(isSpeaking ? 'Agent is speaking...' : 'Listening...');
  }

  private updateMuteButton(): void {
    const btn = this.windowEl?.querySelector('.xp-voice-mute-btn');
    if (btn) {
      btn.innerHTML = this.isMuted ? this.getMicOffIcon() : this.getMicIcon();
      (btn as HTMLElement).title = this.isMuted ? 'Unmute' : 'Mute';
    }
  }

  private updateButtonIcon(): void {
    if (!this.buttonEl) return;
    this.buttonEl.innerHTML = this.isOpen ? this.getCloseIcon() : this.getPhoneIcon();
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ─── Private: Icons ────────────────────────────────────────────────────

  private getPhoneIcon(): string {
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" fill="white"/></svg>`;
  }

  private getCloseIcon(): string {
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  private getHangupIcon(): string {
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91" stroke="white" stroke-width="2" stroke-linecap="round"/><path d="M23 1L1 23" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>`;
  }

  private getMicIcon(): string {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" fill="currentColor"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  private getMicOffIcon(): string {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M1 1l22 22M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 16.95A7 7 0 015 12v-2m14 0v2c0 .76-.12 1.5-.35 2.18M12 19v4M8 23h8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  // ─── Private: Styles ───────────────────────────────────────────────────

  private getStyles(): string {
    const pos = this.config.position === 'bottom-left' ? 'left: 1rem;' : 'right: 1rem;';
    const color = this.config.buttonColor || '#7C3AED';

    return `
      * { box-sizing: border-box; margin: 0; padding: 0; }

      .xp-voice-button {
        position: fixed;
        bottom: 1rem;
        ${pos}
        width: ${this.config.buttonSize}px;
        height: ${this.config.buttonSize}px;
        border-radius: 50%;
        background: ${color};
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: ${this.config.zIndex};
        transition: transform 0.2s ease;
      }
      .xp-voice-button:hover { transform: scale(1.05); }

      .xp-voice-window {
        position: fixed;
        bottom: calc(1rem + ${(this.config.buttonSize || 48) + 12}px);
        ${pos}
        width: ${this.config.windowWidth}px;
        max-width: calc(100vw - 2rem);
        height: ${this.config.windowHeight}px;
        max-height: calc(100vh - 6rem);
        background: #fff;
        border-radius: 12px;
        border: 1px solid #e5e7eb;
        box-shadow: 0 8px 32px rgba(0,0,0,0.12);
        z-index: ${(this.config.zIndex || 2147483647) - 1};
        display: flex;
        flex-direction: column;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .xp-voice-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid #e5e7eb;
        background: ${color};
        color: white;
      }
      .xp-voice-title { font-weight: 600; font-size: 14px; }
      .xp-voice-close-btn {
        background: none; border: none; cursor: pointer; padding: 4px; display: flex; color: white;
      }

      .xp-voice-status {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 16px;
        border-bottom: 1px solid #e5e7eb;
      }
      .xp-voice-status-indicator {
        width: 10px; height: 10px; border-radius: 50%; background: #9ca3af;
      }
      .xp-voice-status-text { font-size: 13px; color: #6b7280; }

      .xp-voice-transcription {
        flex: 1;
        overflow-y: auto;
        padding: 12px 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .xp-voice-transcription::-webkit-scrollbar { width: 4px; }
      .xp-voice-transcription::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 2px; }

      .xp-trans {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .xp-trans-speaker {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .xp-trans-user .xp-trans-speaker { color: ${color}; }
      .xp-trans-agent .xp-trans-speaker { color: #6b7280; }
      .xp-trans-text { font-size: 14px; color: #1a1a1a; line-height: 1.4; }

      .xp-voice-controls {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 16px;
        padding: 16px;
        border-top: 1px solid #e5e7eb;
      }
      .xp-voice-call-btn {
        width: 56px; height: 56px; border-radius: 50%;
        background: #10b981; border: none; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 2px 8px rgba(16,185,129,0.3);
        transition: transform 0.2s;
      }
      .xp-voice-call-btn:hover { transform: scale(1.05); }

      .xp-voice-hangup-btn {
        width: 56px; height: 56px; border-radius: 50%;
        background: #ef4444; border: none; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 2px 8px rgba(239,68,68,0.3);
        transition: transform 0.2s;
      }
      .xp-voice-hangup-btn:hover { transform: scale(1.05); }

      .xp-voice-mute-btn {
        width: 44px; height: 44px; border-radius: 50%;
        background: #f3f4f6; border: 1px solid #e5e7eb;
        cursor: pointer; display: none;
        align-items: center; justify-content: center;
        color: #374151; transition: background 0.2s;
      }
      .xp-voice-mute-btn:hover { background: #e5e7eb; }
    `;
  }
}
