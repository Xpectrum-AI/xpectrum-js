import { ChatWidget, type ChatWidgetConfig } from './chat-widget';
import { VoiceWidget, type VoiceWidgetConfig } from './voice-widget';

export interface OmnichannelWidgetConfig {
  /** Chat server URL */
  chatBaseUrl: string;
  /** API key for chat (used as Bearer token) */
  chatApiKey: string;
  /** Voice server URL */
  voiceBaseUrl: string;
  /** API key for voice server */
  apiKey: string;
  /** Agent name for voice calls */
  agentName: string;
  /** Container element to mount into (defaults to document.body) */
  container?: HTMLElement;
  /** Widget position */
  position?: 'bottom-right' | 'bottom-left';
  /** Trigger button background color */
  buttonColor?: string;
  /** z-index for the widget */
  zIndex?: number;
  /** User identifier */
  user?: string;
  /** Chat-specific overrides */
  chat?: Partial<ChatWidgetConfig>;
  /** Voice-specific overrides */
  voice?: Partial<VoiceWidgetConfig>;
}

/**
 * OmnichannelWidget — Combined chat + voice widget.
 *
 * Renders a single trigger button that expands into a panel
 * offering both chat and voice call options. Internally manages
 * a ChatWidget and VoiceWidget with coordinated positioning.
 */
export class OmnichannelWidget {
  private config: OmnichannelWidgetConfig;
  private container: HTMLElement;
  private chatWidget: ChatWidget | null = null;
  private voiceWidget: VoiceWidget | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private buttonEl: HTMLElement | null = null;
  private menuEl: HTMLElement | null = null;
  private isMenuOpen = false;
  private activeWidget: 'chat' | 'voice' | null = null;

  constructor(config: OmnichannelWidgetConfig) {
    this.config = config;
    this.container = config.container || document.body;
    this.mount();
  }

  openChat(): void {
    this.closeMenu();
    this.activeWidget = 'chat';
    if (!this.chatWidget) {
      this.chatWidget = new ChatWidget({
        apiKey: this.config.chatApiKey,
        baseUrl: this.config.chatBaseUrl,
        container: this.container,
        position: this.config.position || 'bottom-right',
        buttonColor: this.config.buttonColor,
        user: this.config.user,
        zIndex: (this.config.zIndex || 2147483647) - 2,
        ...this.config.chat,
      });
    }
    this.chatWidget.open();
    this.hideMainButton();
  }

  openVoice(): void {
    this.closeMenu();
    this.activeWidget = 'voice';
    if (!this.voiceWidget) {
      this.voiceWidget = new VoiceWidget({
        apiKey: this.config.apiKey,
        agentName: this.config.agentName,
        baseUrl: this.config.voiceBaseUrl,
        container: this.container,
        position: this.config.position || 'bottom-right',
        buttonColor: this.config.buttonColor,
        zIndex: (this.config.zIndex || 2147483647) - 2,
        ...this.config.voice,
      });
    }
    this.voiceWidget.open();
    this.hideMainButton();
  }

  close(): void {
    if (this.activeWidget === 'chat' && this.chatWidget) {
      this.chatWidget.close();
    }
    if (this.activeWidget === 'voice' && this.voiceWidget) {
      this.voiceWidget.close();
    }
    this.activeWidget = null;
    this.showMainButton();
  }

  destroy(): void {
    this.chatWidget?.destroy();
    this.voiceWidget?.destroy();
    const host = this.container.querySelector('#xpectrum-omni-widget-host');
    if (host) host.remove();
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private mount(): void {
    const host = document.createElement('div');
    host.id = 'xpectrum-omni-widget-host';
    this.container.appendChild(host);
    this.shadowRoot = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = this.getStyles();
    this.shadowRoot.appendChild(style);

    this.menuEl = this.createMenu();
    this.shadowRoot.appendChild(this.menuEl);

    this.buttonEl = this.createButton();
    this.shadowRoot.appendChild(this.buttonEl);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.isMenuOpen) this.closeMenu();
        else this.close();
      }
    });
  }

  private createButton(): HTMLElement {
    const btn = document.createElement('div');
    btn.className = 'xp-omni-button';
    btn.innerHTML = this.getMenuIcon();
    btn.addEventListener('click', () => {
      this.isMenuOpen ? this.closeMenu() : this.openMenu();
    });
    return btn;
  }

  private createMenu(): HTMLElement {
    const menu = document.createElement('div');
    menu.className = 'xp-omni-menu';
    menu.style.display = 'none';

    menu.innerHTML = `
      <button class="xp-omni-option xp-omni-option-chat">
        ${this.getChatIcon()}
        <span>Chat</span>
      </button>
      <button class="xp-omni-option xp-omni-option-voice">
        ${this.getPhoneIcon()}
        <span>Voice Call</span>
      </button>
    `;

    menu.querySelector('.xp-omni-option-chat')?.addEventListener('click', () => this.openChat());
    menu.querySelector('.xp-omni-option-voice')?.addEventListener('click', () => this.openVoice());

    return menu;
  }

  private openMenu(): void {
    if (this.menuEl) this.menuEl.style.display = 'flex';
    this.isMenuOpen = true;
    if (this.buttonEl) this.buttonEl.innerHTML = this.getCloseIcon();
  }

  private closeMenu(): void {
    if (this.menuEl) this.menuEl.style.display = 'none';
    this.isMenuOpen = false;
    if (this.buttonEl) this.buttonEl.innerHTML = this.getMenuIcon();
  }

  private hideMainButton(): void {
    if (this.buttonEl) this.buttonEl.style.display = 'none';
    if (this.menuEl) this.menuEl.style.display = 'none';
    this.isMenuOpen = false;
  }

  private showMainButton(): void {
    if (this.buttonEl) {
      this.buttonEl.style.display = 'flex';
      this.buttonEl.innerHTML = this.getMenuIcon();
    }
  }

  // ─── Icons ──────────────────────────────────────────────────────────────

  private getMenuIcon(): string {
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="1" fill="white"/><circle cx="12" cy="6" r="1" fill="white"/><circle cx="12" cy="18" r="1" fill="white"/></svg>`;
  }

  private getChatIcon(): string {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  private getPhoneIcon(): string {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  private getCloseIcon(): string {
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  // ─── Styles ─────────────────────────────────────────────────────────────

  private getStyles(): string {
    const pos = this.config.position === 'bottom-left' ? 'left: 1rem;' : 'right: 1rem;';
    const color = this.config.buttonColor || '#7C3AED';

    return `
      * { box-sizing: border-box; margin: 0; padding: 0; }

      .xp-omni-button {
        position: fixed;
        bottom: 1rem;
        ${pos}
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: ${color};
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: ${this.config.zIndex || 2147483647};
        transition: transform 0.2s ease;
      }
      .xp-omni-button:hover { transform: scale(1.05); }

      .xp-omni-menu {
        position: fixed;
        bottom: calc(1rem + 60px);
        ${pos}
        display: flex;
        flex-direction: column;
        gap: 8px;
        z-index: ${(this.config.zIndex || 2147483647) - 1};
      }

      .xp-omni-option {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 16px;
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        cursor: pointer;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        font-weight: 500;
        color: #374151;
        box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        transition: all 0.2s ease;
        white-space: nowrap;
      }
      .xp-omni-option:hover {
        background: #f9fafb;
        border-color: ${color};
        color: ${color};
      }
    `;
  }
}
