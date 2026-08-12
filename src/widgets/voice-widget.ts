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
  /** Accent colour — the orb, launcher and glow. */
  buttonColor?: string;
  /** Trigger button size in px */
  buttonSize?: number;
  /** z-index for the widget */
  zIndex?: number;
  /** Card width in px */
  windowWidth?: number;
  /** @deprecated The call card sizes to its content. */
  windowHeight?: number;
  /** Title shown above the orb. Defaults to 'Voice assistant'. */
  title?: string;
  /** Called for each transcription segment */
  onTranscription?: (segment: TranscriptionSegment) => void;
  /** Called on connection state changes */
  onStateChange?: (state: VoiceConnectionState) => void;
}

const DEFAULT_CONFIG: Partial<VoiceWidgetConfig> = {
  position: 'bottom-right',
  buttonColor: '#7C3AED',
  buttonSize: 56,
  zIndex: 2147483647,
  windowWidth: 240,
};

/**
 * VoiceWidget — Drop-in embeddable voice assistant.
 *
 * A floating launcher opens a compact call card: a vivid animated orb you tap
 * to start talking. While the agent speaks, an analyser reads its live audio
 * and drives the orb and the rings around it, so the visual moves with the
 * actual sound. No transcript log — this is a phone call, not a chat.
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
  private isMuted = false;
  private callStartedAt: number | null = null;
  private timerHandle: ReturnType<typeof setInterval> | null = null;

  // Audio-reactive visualization
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserData: Uint8Array | null = null;
  private rafId: number | null = null;
  private level = 0;

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
    this.stopTimer();
    this.stopVisualizer();
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
    btn.innerHTML = `<span class="xp-voice-button-ring"></span>${this.getMicIcon(24)}`;
    btn.addEventListener('click', () => this.toggle());
    return btn;
  }

  private createWindow(): HTMLElement {
    const win = document.createElement('div');
    win.className = 'xp-voice-card xp-state-disconnected';
    win.style.display = 'none';

    win.innerHTML = `
      <button class="xp-voice-close" title="Close" aria-label="Close">${this.getCloseIcon()}</button>

      <div class="xp-orb-zone">
        <div class="xp-wave xp-wave-1"></div>
        <div class="xp-wave xp-wave-2"></div>
        <div class="xp-wave xp-wave-3"></div>
        <button class="xp-orb" title="Start call" aria-label="Start call">
          <span class="xp-orb-swirl"></span>
          <span class="xp-orb-glass"></span>
        </button>
      </div>

      <div class="xp-voice-status">Tap to talk</div>
      <div class="xp-voice-caption"></div>

      <div class="xp-voice-footer">
        <span class="xp-voice-timer">00:00</span>
        <div class="xp-voice-controls">
          <button class="xp-ctl xp-ctl-mute" title="Mute" aria-label="Mute">${this.getMicIcon(16)}</button>
          <button class="xp-ctl xp-ctl-end" title="End call" aria-label="End call">${this.getHangupIcon()}</button>
        </div>
      </div>
    `;

    win.querySelector('.xp-voice-close')?.addEventListener('click', () => this.close());
    win.querySelector('.xp-orb')?.addEventListener('click', () => {
      if (this.state === 'disconnected' || this.state === 'failed') this.startCall();
    });
    win.querySelector('.xp-ctl-end')?.addEventListener('click', () => this.hangUp());
    win.querySelector('.xp-ctl-mute')?.addEventListener('click', () => this.toggleMute());

    return win;
  }

  // ─── Private: Call Control ──────────────────────────────────────────────

  private async startCall(): Promise<void> {
    this.updateState('connecting');
    this.setCaption('');

    try {
      await this.voice.connect({
        onConnected: () => {
          this.updateState('connected');
          this.startTimer();
        },
        onAgentAudio: (stream) => {
          this.startVisualizer(stream);
        },
        onTranscription: (segment) => {
          this.setCaption(segment.speaker === 'user' ? `“${segment.text}”` : segment.text);
          this.config.onTranscription?.(segment);
        },
        onAgentSpeaking: (isSpeaking) => {
          this.windowEl?.classList.toggle('xp-agent-speaking', isSpeaking);
          this.updateStatusText(isSpeaking ? 'Speaking…' : 'Listening…');
        },
        onDisconnected: () => {
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
          this.setCaption(error.message);
        },
      });
    } catch (error: any) {
      this.updateState('failed');
      this.setCaption(error.message || 'Could not connect');
    }
  }

  private async hangUp(): Promise<void> {
    await this.voice.disconnect();
    this.updateState('disconnected');
  }

  private async toggleMute(): Promise<void> {
    this.isMuted = !this.isMuted;
    await this.voice.setMicEnabled(!this.isMuted);
    const btn = this.windowEl?.querySelector('.xp-ctl-mute') as HTMLElement | null;
    if (btn) {
      btn.innerHTML = this.isMuted ? this.getMicOffIcon() : this.getMicIcon(16);
      btn.title = this.isMuted ? 'Unmute' : 'Mute';
      btn.classList.toggle('xp-ctl-muted', this.isMuted);
    }
  }

  // ─── Private: Audio-reactive visualizer ─────────────────────────────────

  /**
   * Reads the agent's live audio and drives the orb + waves each frame, so
   * the visual follows the actual sound instead of a canned animation.
   */
  private startVisualizer(stream: MediaStream): void {
    this.stopVisualizer();
    try {
      this.audioCtx = new AudioContext();
      const source = this.audioCtx.createMediaStreamSource(stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.6;
      source.connect(this.analyser);
      this.analyserData = new Uint8Array(this.analyser.fftSize);
      this.windowEl?.classList.add('xp-reactive');
      this.tick();
    } catch {
      // Visualizer is cosmetic — the call works without it
    }
  }

  private tick = (): void => {
    if (!this.analyser || !this.analyserData) return;

    this.analyser.getByteTimeDomainData(this.analyserData);
    let sum = 0;
    for (let i = 0; i < this.analyserData.length; i++) {
      const v = (this.analyserData[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.analyserData.length);
    // Fast attack, slow release — keeps the motion lively but not jittery
    const target = Math.min(1, rms * 4.5);
    this.level = target > this.level ? target : this.level * 0.88;

    const orb = this.windowEl?.querySelector('.xp-orb') as HTMLElement | null;
    if (orb) orb.style.transform = `scale(${1 + this.level * 0.16})`;

    const waves = this.windowEl?.querySelectorAll('.xp-wave') as NodeListOf<HTMLElement> | undefined;
    waves?.forEach((w, i) => {
      const grow = this.level * (0.35 + i * 0.28);
      w.style.transform = `scale(${1 + grow})`;
      w.style.opacity = String(Math.max(0, this.level * 0.85 - i * 0.18));
    });

    this.rafId = requestAnimationFrame(this.tick);
  };

  private stopVisualizer(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.analyser = null;
    this.analyserData = null;
    this.level = 0;
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => null);
      this.audioCtx = null;
    }
    this.windowEl?.classList.remove('xp-reactive');
    const orb = this.windowEl?.querySelector('.xp-orb') as HTMLElement | null;
    if (orb) orb.style.transform = '';
    (this.windowEl?.querySelectorAll('.xp-wave') as NodeListOf<HTMLElement> | undefined)?.forEach((w) => {
      w.style.transform = '';
      w.style.opacity = '';
    });
  }

  // ─── Private: Timer ─────────────────────────────────────────────────────

  private startTimer(): void {
    if (this.timerHandle) return;
    this.callStartedAt = Date.now();
    this.timerHandle = setInterval(() => {
      const s = Math.floor((Date.now() - (this.callStartedAt || Date.now())) / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      const el = this.windowEl?.querySelector('.xp-voice-timer');
      if (el) el.textContent = `${mm}:${ss}`;
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timerHandle) clearInterval(this.timerHandle);
    this.timerHandle = null;
    this.callStartedAt = null;
    const el = this.windowEl?.querySelector('.xp-voice-timer');
    if (el) el.textContent = '00:00';
  }

  // ─── Private: UI Updates ────────────────────────────────────────────────

  private updateState(state: VoiceConnectionState): void {
    this.state = state;
    this.config.onStateChange?.(state);

    const win = this.windowEl;
    if (!win) return;
    win.classList.remove(
      'xp-state-disconnected', 'xp-state-connecting', 'xp-state-connected',
      'xp-state-reconnecting', 'xp-state-failed', 'xp-agent-speaking',
    );
    win.classList.add(`xp-state-${state}`);

    switch (state) {
      case 'disconnected':
        this.updateStatusText('Tap to talk');
        this.stopTimer();
        this.stopVisualizer();
        this.isMuted = false;
        break;
      case 'connecting':
        this.updateStatusText('Connecting…');
        break;
      case 'connected':
        this.updateStatusText('Listening…');
        break;
      case 'reconnecting':
        this.updateStatusText('Reconnecting…');
        break;
      case 'failed':
        this.updateStatusText('Tap to retry');
        this.stopTimer();
        this.stopVisualizer();
        break;
    }
  }

  private updateStatusText(text: string): void {
    const el = this.windowEl?.querySelector('.xp-voice-status');
    if (el) el.textContent = text;
  }

  private setCaption(text: string): void {
    const el = this.windowEl?.querySelector('.xp-voice-caption');
    if (el) el.textContent = text;
  }

  private updateButtonIcon(): void {
    if (!this.buttonEl) return;
    this.buttonEl.innerHTML = this.isOpen
      ? `<span class="xp-voice-button-ring"></span>${this.getCloseIcon()}`
      : `<span class="xp-voice-button-ring"></span>${this.getMicIcon(24)}`;
  }

  // ─── Private: Icons ────────────────────────────────────────────────────

  private getCloseIcon(): string {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  private getHangupIcon(): string {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21.7 14.4c-.6.6-1.5.7-2.2.4l-2.6-1.1a2 2 0 01-1.2-1.6l-.2-1.4a13.4 13.4 0 00-7 0l-.2 1.4a2 2 0 01-1.2 1.6l-2.6 1.1c-.7.3-1.6.2-2.2-.4l-1-1c-.8-.8-.9-2-.1-2.8C3.5 8 7.5 6 12 6s8.5 2 10.8 4.6c.8.8.7 2-.1 2.8l-1 1z" fill="currentColor"/></svg>`;
  }

  private getMicIcon(size = 20): string {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" fill="currentColor"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  private getMicOffIcon(): string {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M1 1l22 22M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 16.95A7 7 0 015 12v-2m14 0v2c0 .76-.12 1.5-.35 2.18M12 19v4M8 23h8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  // ─── Private: Styles ───────────────────────────────────────────────────

  private getStyles(): string {
    const pos = this.config.position === 'bottom-left' ? 'left: 1.25rem;' : 'right: 1.25rem;';
    const accent = this.config.buttonColor || '#7C3AED';
    const size = this.config.buttonSize || 56;

    return `
      * { box-sizing: border-box; margin: 0; padding: 0; }

      /* ─── Launcher ─── */
      .xp-voice-button {
        position: fixed;
        bottom: 1.25rem;
        ${pos}
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        background: linear-gradient(135deg, #22d3ee 0%, ${accent} 45%, #e879f9 100%);
        box-shadow: 0 6px 22px color-mix(in srgb, ${accent} 55%, transparent);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        z-index: ${this.config.zIndex};
        transition: transform 0.2s ease;
      }
      .xp-voice-button:hover { transform: scale(1.06); }
      .xp-voice-button-ring {
        position: absolute; inset: 0; border-radius: 50%;
        border: 2px solid color-mix(in srgb, ${accent} 65%, transparent);
        animation: xp-launcher-pulse 2.6s ease-out infinite;
      }
      @keyframes xp-launcher-pulse {
        0%   { transform: scale(1);    opacity: 0.9; }
        70%  { transform: scale(1.45); opacity: 0; }
        100% { transform: scale(1.45); opacity: 0; }
      }

      /* ─── Call card — compact ─── */
      .xp-voice-card {
        position: fixed;
        bottom: calc(1.25rem + ${size + 14}px);
        ${pos}
        width: ${this.config.windowWidth}px;
        max-width: calc(100vw - 2rem);
        padding: 14px 14px 10px;
        background: #ffffff;
        border-radius: 20px;
        border: 1px solid rgba(0,0,0,0.06);
        box-shadow: 0 18px 44px rgba(30, 8, 70, 0.22);
        z-index: ${(this.config.zIndex || 2147483647) - 1};
        display: flex;
        flex-direction: column;
        align-items: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .xp-voice-close {
        position: absolute; top: 8px; right: 8px;
        width: 26px; height: 26px; border-radius: 50%;
        background: rgba(0,0,0,0.04); border: none; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        color: #9ca3af; transition: background .2s, color .2s;
        z-index: 1;
      }
      .xp-voice-close:hover { background: rgba(0,0,0,0.08); color: #4b5563; }

      /* ─── Orb ─── */
      .xp-orb-zone {
        position: relative;
        width: 132px; height: 132px;
        margin: 10px 0 4px;
        display: flex; align-items: center; justify-content: center;
      }
      .xp-orb {
        position: relative;
        width: 92px; height: 92px;
        border-radius: 50%;
        border: none; padding: 0; cursor: pointer;
        background:
          radial-gradient(120% 120% at 68% 78%, #e879f9 0%, transparent 45%),
          radial-gradient(120% 120% at 22% 76%, #22d3ee 0%, transparent 50%),
          radial-gradient(130% 130% at 35% 20%, color-mix(in srgb, ${accent} 60%, white) 0%, ${accent} 58%, color-mix(in srgb, ${accent} 62%, black) 100%);
        box-shadow:
          0 8px 30px color-mix(in srgb, ${accent} 60%, transparent),
          0 0 44px color-mix(in srgb, #e879f9 35%, transparent),
          inset 0 -6px 18px rgba(0,0,0,0.22),
          inset 0 6px 12px rgba(255,255,255,0.4);
        overflow: hidden;
        animation: xp-orb-breathe 4.2s ease-in-out infinite;
        will-change: transform;
      }
      /* When the analyser drives the orb, canned animations get out of the way */
      .xp-reactive .xp-orb { animation: none; transition: transform .06s linear; }

      .xp-state-disconnected .xp-orb:hover,
      .xp-state-failed .xp-orb:hover { transform: scale(1.05); }
      .xp-state-connected .xp-orb,
      .xp-state-connecting .xp-orb,
      .xp-state-reconnecting .xp-orb { cursor: default; }

      .xp-orb-swirl {
        position: absolute; inset: -18%;
        background:
          conic-gradient(from 0deg,
            transparent 0deg, color-mix(in srgb, #22d3ee 70%, transparent) 80deg,
            transparent 160deg, color-mix(in srgb, #e879f9 70%, transparent) 250deg,
            transparent 360deg);
        filter: blur(12px); opacity: .9;
        mix-blend-mode: screen;
        animation: xp-swirl 5.5s linear infinite;
      }
      @keyframes xp-swirl { to { transform: rotate(360deg); } }

      .xp-orb-glass {
        position: absolute; inset: 0; border-radius: 50%;
        background: radial-gradient(85% 55% at 32% 16%, rgba(255,255,255,.6) 0%, rgba(255,255,255,0) 55%);
      }
      @keyframes xp-orb-breathe {
        0%, 100% { transform: scale(1); }
        50%      { transform: scale(1.03); }
      }

      /* ─── Audio waves (driven per-frame by the analyser) ─── */
      .xp-wave {
        position: absolute;
        width: 92px; height: 92px;
        border-radius: 50%;
        opacity: 0;
        pointer-events: none;
        will-change: transform, opacity;
      }
      .xp-wave-1 { border: 3px solid color-mix(in srgb, ${accent} 75%, transparent); }
      .xp-wave-2 { border: 2px solid color-mix(in srgb, #22d3ee 75%, transparent); }
      .xp-wave-3 { border: 2px solid color-mix(in srgb, #e879f9 70%, transparent); }

      /* Connecting: spinner arc around the orb */
      .xp-state-connecting .xp-wave-1,
      .xp-state-reconnecting .xp-wave-1 {
        opacity: 1;
        border: 3px solid transparent;
        border-top-color: ${accent};
        animation: xp-spin 1s linear infinite;
      }
      @keyframes xp-spin { to { transform: rotate(360deg); } }

      /* ─── Status / caption ─── */
      .xp-voice-status {
        font-size: 14px; font-weight: 700; color: #111827;
        min-height: 20px; letter-spacing: .01em;
      }
      .xp-voice-caption {
        margin-top: 4px;
        min-height: 30px;
        max-width: 100%;
        font-size: 12px; line-height: 1.3; color: #6b7280;
        text-align: center;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .xp-state-failed .xp-voice-caption { color: #ef4444; }

      /* ─── Footer: timer + controls in one compact row ─── */
      .xp-voice-footer {
        width: 100%;
        display: flex; align-items: center; justify-content: space-between;
        margin-top: 8px;
        min-height: 38px;
        visibility: hidden;
      }
      .xp-state-connected .xp-voice-footer,
      .xp-state-connecting .xp-voice-footer,
      .xp-state-reconnecting .xp-voice-footer { visibility: visible; }

      .xp-voice-timer {
        font-size: 12px; color: #9ca3af; font-variant-numeric: tabular-nums;
        padding-left: 4px;
      }
      .xp-voice-controls { display: flex; align-items: center; gap: 10px; }

      .xp-ctl {
        width: 38px; height: 38px; border-radius: 50%;
        border: none; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: transform .15s ease, background .2s;
      }
      .xp-ctl:hover { transform: scale(1.07); }
      .xp-ctl-mute { background: #f3f4f6; color: #374151; border: 1px solid #e5e7eb; }
      .xp-ctl-mute.xp-ctl-muted { background: #fee2e2; color: #b91c1c; border-color: #fecaca; }
      .xp-ctl-end { background: #ef4444; color: #fff; box-shadow: 0 5px 14px rgba(239,68,68,.4); }
    `;
  }
}
