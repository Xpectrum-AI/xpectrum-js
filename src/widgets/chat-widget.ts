import { XpectrumChat } from '../chat/chat-client';
import type { StreamOptions } from '../chat/types';

export interface ChatWidgetConfig {
  /** API key — used as Bearer token */
  apiKey: string;
  /** Base URL of the Xpectrum API — the "API Server" value shown in the console */
  baseUrl: string;
  /** Container element to mount into (defaults to document.body) */
  container?: HTMLElement;
  /** Widget position */
  position?: 'bottom-right' | 'bottom-left';
  /** Trigger button background color */
  buttonColor?: string;
  /** Trigger button size in px */
  buttonSize?: number;
  /** Color theme */
  theme?: 'light' | 'dark' | 'auto';
  /** z-index for the widget */
  zIndex?: number;
  /** Welcome message shown before first interaction */
  welcomeMessage?: string;
  /** User identifier */
  user?: string;
  /** Window width in px */
  windowWidth?: number;
  /** Window height in px */
  windowHeight?: number;
}

/** A message as rendered in the widget — distinct from the API's ChatMessage. */
interface WidgetMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

const DEFAULT_CONFIG: Partial<ChatWidgetConfig> = {
  position: 'bottom-right',
  buttonColor: '#7C3AED',
  buttonSize: 48,
  theme: 'light',
  zIndex: 2147483647,
  windowWidth: 400,
  windowHeight: 600,
};

/**
 * ChatWidget — Drop-in embeddable chat bubble.
 *
 * Renders a floating button that opens an inline chat window.
 * Uses XpectrumChat internally for API communication.
 */
export class ChatWidget {
  private config: Required<Pick<ChatWidgetConfig, 'apiKey' | 'baseUrl'>> & ChatWidgetConfig;
  private chat: XpectrumChat;
  private container: HTMLElement;
  private buttonEl: HTMLElement | null = null;
  private windowEl: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private isOpen = false;
  private messages: WidgetMessage[] = [];
  private conversationId: string | null = null;
  private opened = false;
  private streaming = false;
  private currentTaskId: string | null = null;
  private abortCurrent: AbortController | null = null;

  constructor(config: ChatWidgetConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config } as any;
    this.container = config.container || document.body;
    this.chat = new XpectrumChat({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      user: config.user,
    });
    this.conversationId = this.loadConversationId();
    this.mount();
  }

  open(): void {
    if (!this.windowEl) return;
    this.windowEl.style.display = 'flex';
    this.isOpen = true;
    this.updateButtonIcon();
    // First open only — restore the last conversation, or greet
    if (!this.opened) {
      this.opened = true;
      this.restoreOrGreet();
    }
  }

  close(): void {
    if (!this.windowEl) return;
    this.windowEl.style.display = 'none';
    this.isOpen = false;
    this.updateButtonIcon();
  }

  toggle(): void {
    this.isOpen ? this.close() : this.open();
  }

  destroy(): void {
    this.chat.destroy();
    if (this.buttonEl) this.buttonEl.remove();
    if (this.windowEl) this.windowEl.remove();
    const host = this.container.querySelector('#xpectrum-chat-widget-host');
    if (host) host.remove();
  }

  // ─── Private: Mount ─────────────────────────────────────────────────────

  private mount(): void {
    // Create shadow host for style isolation
    const host = document.createElement('div');
    host.id = 'xpectrum-chat-widget-host';
    this.container.appendChild(host);
    this.shadowRoot = host.attachShadow({ mode: 'open' });

    // Inject styles
    const style = document.createElement('style');
    style.textContent = this.getStyles();
    this.shadowRoot.appendChild(style);

    // Create button
    this.buttonEl = this.createButton();
    this.shadowRoot.appendChild(this.buttonEl);

    // Create chat window
    this.windowEl = this.createWindow();
    this.shadowRoot.appendChild(this.windowEl);

    // ESC to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
  }

  private createButton(): HTMLElement {
    const btn = document.createElement('div');
    btn.className = 'xp-chat-button';
    btn.innerHTML = this.getChatIcon();
    btn.addEventListener('click', () => this.toggle());
    return btn;
  }

  private createWindow(): HTMLElement {
    const win = document.createElement('div');
    win.className = 'xp-chat-window';
    win.style.display = 'none';

    win.innerHTML = `
      <div class="xp-chat-header">
        <span class="xp-chat-header-title">Chat</span>
        <button class="xp-chat-close-btn">${this.getCloseIcon()}</button>
      </div>
      <div class="xp-chat-messages"></div>
      <div class="xp-chat-input-area">
        <textarea class="xp-chat-input" placeholder="Type a message..." rows="1"></textarea>
        <button class="xp-chat-send-btn">${this.getSendIcon()}</button>
      </div>
    `;

    // Close button
    win.querySelector('.xp-chat-close-btn')?.addEventListener('click', () => this.close());

    // Input handling
    const input = win.querySelector('.xp-chat-input') as HTMLTextAreaElement;
    const sendBtn = win.querySelector('.xp-chat-send-btn') as HTMLButtonElement;

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!this.streaming) this.handleSend(input);
      }
    });

    // Auto-resize textarea
    input?.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    // The same button sends, then stops while a reply is streaming
    sendBtn?.addEventListener('click', () => {
      if (this.streaming) this.stopGeneration();
      else this.handleSend(input);
    });

    return win;
  }

  /** Swap the send button between "send" and "stop" as streaming starts/ends. */
  private updateSendButton(): void {
    const btn = this.windowEl?.querySelector('.xp-chat-send-btn') as HTMLButtonElement | null;
    if (!btn) return;
    btn.innerHTML = this.streaming ? this.getStopIcon() : this.getSendIcon();
    btn.setAttribute('aria-label', this.streaming ? 'Stop' : 'Send');
    btn.setAttribute('title', this.streaming ? 'Stop generating' : 'Send');
  }

  // ─── Private: Messaging ─────────────────────────────────────────────────

  private async handleSend(input: HTMLTextAreaElement): Promise<void> {
    const query = input.value.trim();
    if (!query) return;
    input.value = '';
    input.style.height = 'auto';

    // Add user message
    const userMsg: WidgetMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: query,
    };
    this.messages.push(userMsg);

    // Add placeholder for assistant
    const assistantMsg: WidgetMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      isStreaming: true,
    };
    this.messages.push(assistantMsg);
    this.renderMessages();

    this.streaming = true;
    this.updateSendButton();

    const options: StreamOptions = {
      conversationId: this.conversationId || undefined,
      getAbortController: (controller) => {
        this.abortCurrent = controller;
      },
      onToken: (_delta, full) => {
        assistantMsg.content = full;
        this.renderMessages();
      },
      onDone: (result) => {
        if (result.taskId) this.currentTaskId = result.taskId;
        assistantMsg.isStreaming = false;
        this.renderMessages();
      },
      onError: (error) => {
        assistantMsg.content = `Error: ${error.message}`;
        assistantMsg.isStreaming = false;
        this.renderMessages();
      },
    };

    const result = await this.chat.stream(query, options);

    // Keep the conversation going on the next message, and across reloads
    if (result.conversationId) {
      this.conversationId = result.conversationId;
      this.saveConversationId(result.conversationId);
    }
    if (result.taskId) this.currentTaskId = result.taskId;

    this.streaming = false;
    this.abortCurrent = null;
    assistantMsg.isStreaming = false;
    this.renderMessages();
    this.updateSendButton();
  }

  /**
   * Stop the reply in progress.
   *
   * Aborts locally so the UI stops immediately, then tells the server — without
   * the second half the model keeps generating and keeps consuming tokens.
   */
  private stopGeneration(): void {
    this.abortCurrent?.abort();
    this.abortCurrent = null;
    this.streaming = false;

    const taskId = this.currentTaskId;
    this.currentTaskId = null;
    if (taskId) this.chat.cancel(taskId).catch(() => {});

    const last = this.messages[this.messages.length - 1];
    if (last && last.isStreaming) last.isStreaming = false;

    this.renderMessages();
    this.updateSendButton();
  }

  // ─── Private: Opening state ────────────────────────────────────────────

  /**
   * Restore the previous conversation if there is one, otherwise greet.
   *
   * The greeting comes from the console via `GET /config`, so whoever
   * configures the agent controls it. `welcomeMessage` in config is used as a
   * fallback when the app has no opening statement set.
   */
  private async restoreOrGreet(): Promise<void> {
    if (this.conversationId) {
      try {
        const page = await this.chat.getMessages(this.conversationId, { limit: 50 });
        if (page.data.length) {
          this.messages = page.data.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
          }));
          this.renderMessages();
          return;
        }
      } catch {
        // Thread is gone or unreachable — fall through and start fresh
        this.conversationId = null;
        this.saveConversationId(null);
      }
    }

    await this.showGreeting();
  }

  private async showGreeting(): Promise<void> {
    let greeting = this.config.welcomeMessage;

    try {
      const appConfig = await this.chat.getConfig();
      greeting = appConfig.greeting || greeting;
    } catch {
      // Config is optional — fall back to whatever the embed supplied
    }

    if (greeting && this.messages.length === 0) {
      this.messages.push({ id: 'welcome', role: 'assistant', content: greeting });
      this.renderMessages();
    }
  }

  // ─── Private: Persistence ──────────────────────────────────────────────

  /** Scoped per app and user, so two widgets on one page never collide. */
  private storageKey(): string {
    return `xpectrum:thread:${this.config.baseUrl}:${this.config.user || 'anon'}`;
  }

  private loadConversationId(): string | null {
    try {
      return window.localStorage.getItem(this.storageKey());
    } catch {
      // Storage can be unavailable (private mode, blocked cookies)
      return null;
    }
  }

  private saveConversationId(id: string | null): void {
    try {
      if (id) window.localStorage.setItem(this.storageKey(), id);
      else window.localStorage.removeItem(this.storageKey());
    } catch {
      // Non-fatal — the conversation just will not survive a reload
    }
  }

  // ─── Private: Rendering ────────────────────────────────────────────────

  private renderMessages(): void {
    const container = this.windowEl?.querySelector('.xp-chat-messages');
    if (!container) return;

    container.innerHTML = this.messages
      .map(
        (msg) => `
      <div class="xp-msg xp-msg-${msg.role}">
        <div class="xp-msg-bubble xp-msg-bubble-${msg.role}">
          ${this.escapeHtml(msg.content)}${msg.isStreaming ? '<span class="xp-typing-cursor">|</span>' : ''}
        </div>
      </div>
    `,
      )
      .join('');

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
  }

  private updateButtonIcon(): void {
    if (!this.buttonEl) return;
    this.buttonEl.innerHTML = this.isOpen ? this.getCloseIcon() : this.getChatIcon();
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ─── Private: Icons ────────────────────────────────────────────────────

  private getChatIcon(): string {
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" fill="white"/>
    </svg>`;
  }

  private getCloseIcon(): string {
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 6L6 18M6 6l12 12" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  private getStopIcon(): string {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/>
    </svg>`;
  }

  private getSendIcon(): string {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  // ─── Private: Styles ───────────────────────────────────────────────────

  private getStyles(): string {
    const pos = this.config.position === 'bottom-left' ? 'left: 1rem;' : 'right: 1rem;';
    const winPos = this.config.position === 'bottom-left' ? 'left: 1rem;' : 'right: 1rem;';
    const isDark = this.config.theme === 'dark';
    const bg = isDark ? '#1a1a2e' : '#ffffff';
    const text = isDark ? '#e0e0e0' : '#1a1a1a';
    const border = isDark ? '#333' : '#e5e7eb';
    const inputBg = isDark ? '#16213e' : '#f9fafb';
    const userBubbleBg = this.config.buttonColor || '#7C3AED';
    const assistantBubbleBg = isDark ? '#2a2a4a' : '#f3f4f6';

    return `
      * { box-sizing: border-box; margin: 0; padding: 0; }

      .xp-chat-button {
        position: fixed;
        bottom: 1rem;
        ${pos}
        width: ${this.config.buttonSize}px;
        height: ${this.config.buttonSize}px;
        border-radius: 50%;
        background: ${this.config.buttonColor};
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: ${this.config.zIndex};
        transition: transform 0.2s ease;
      }
      .xp-chat-button:hover { transform: scale(1.05); }

      .xp-chat-window {
        position: fixed;
        bottom: calc(1rem + ${(this.config.buttonSize || 48) + 12}px);
        ${winPos}
        width: ${this.config.windowWidth}px;
        max-width: calc(100vw - 2rem);
        height: ${this.config.windowHeight}px;
        max-height: calc(100vh - 6rem);
        background: ${bg};
        border-radius: 12px;
        border: 1px solid ${border};
        box-shadow: 0 8px 32px rgba(0,0,0,0.12);
        z-index: ${(this.config.zIndex || 2147483647) - 1};
        display: flex;
        flex-direction: column;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: ${text};
      }

      .xp-chat-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid ${border};
        background: ${this.config.buttonColor};
        color: white;
      }
      .xp-chat-header-title {
        font-weight: 600;
        font-size: 14px;
      }
      .xp-chat-close-btn {
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px;
        display: flex;
        color: white;
      }

      .xp-chat-messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .xp-chat-messages::-webkit-scrollbar { width: 4px; }
      .xp-chat-messages::-webkit-scrollbar-thumb { background: ${border}; border-radius: 2px; }

      .xp-msg {
        display: flex;
      }
      .xp-msg-user { justify-content: flex-end; }
      .xp-msg-assistant { justify-content: flex-start; }

      .xp-msg-bubble {
        max-width: 80%;
        padding: 8px 12px;
        border-radius: 12px;
        font-size: 14px;
        line-height: 1.5;
        word-wrap: break-word;
        white-space: pre-wrap;
      }
      .xp-msg-bubble-user {
        background: ${userBubbleBg};
        color: white;
        border-bottom-right-radius: 4px;
      }
      .xp-msg-bubble-assistant {
        background: ${assistantBubbleBg};
        color: ${text};
        border-bottom-left-radius: 4px;
      }

      .xp-typing-cursor {
        animation: xp-blink 1s step-end infinite;
        font-weight: 100;
      }
      @keyframes xp-blink { 50% { opacity: 0; } }

      .xp-chat-input-area {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        padding: 12px 16px;
        border-top: 1px solid ${border};
        background: ${bg};
      }
      .xp-chat-input {
        flex: 1;
        border: 1px solid ${border};
        background: ${inputBg};
        color: ${text};
        border-radius: 8px;
        padding: 8px 12px;
        font-size: 14px;
        font-family: inherit;
        resize: none;
        outline: none;
        max-height: 120px;
        line-height: 1.4;
      }
      .xp-chat-input:focus { border-color: ${this.config.buttonColor}; }
      .xp-chat-send-btn {
        background: ${this.config.buttonColor};
        border: none;
        border-radius: 8px;
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        color: white;
        flex-shrink: 0;
      }
      .xp-chat-send-btn:hover { opacity: 0.9; }
    `;
  }
}
