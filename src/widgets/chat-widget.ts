import { XpectrumChat } from '../chat/chat-client';
import { renderMarkdown } from '../core/markdown';
import type { StreamOptions, Thread } from '../chat/types';

export interface ChatWidgetConfig {
  /** API key — used as Bearer token */
  apiKey: string;
  /** Base URL of the Xpectrum API — the "API Server" value shown in the console */
  baseUrl: string;
  /**
   * Who the conversation belongs to. Omit it and the widget issues a random
   * anonymous id per browser, so a visitor keeps their history without logging
   * in. Set it from your authenticated session once they do.
   */
  user?: string;
  /** Days an auto-generated anonymous id survives. Defaults to 30. */
  anonymousTtlDays?: number;
  /** Container element to mount into (defaults to document.body) */
  container?: HTMLElement;

  // ─── Branding ──────────────────────────────────────────────────────────
  /** Logo shown in the header — an image URL or a `data:` URI. */
  logo?: string;
  /** Header title. Falls back to the app's configured title, then 'Chat'. */
  title?: string;
  /** Greeting for a new conversation. Falls back to the app's configured one. */
  welcomeMessage?: string;
  /** Placeholder text in the message box. */
  inputPlaceholder?: string;

  // ─── Layout ────────────────────────────────────────────────────────────
  position?: 'bottom-right' | 'bottom-left';
  buttonSize?: number;
  windowWidth?: number;
  windowHeight?: number;
  zIndex?: number;

  // ─── Theme ─────────────────────────────────────────────────────────────
  theme?: 'light' | 'dark' | 'auto';
  /** Brand colour — launcher, header, user bubbles and the send button. */
  primaryColor?: string;
  /** Text colour on top of `primaryColor`. */
  onPrimaryColor?: string;
  /** @deprecated use `primaryColor`. Kept so existing embeds keep working. */
  buttonColor?: string;
  /** Window background. */
  backgroundColor?: string;
  /** Body text colour. */
  textColor?: string;
  fontFamily?: string;
  /** Base font size in px — everything else scales from this. */
  fontSize?: number;
  /** Corner rounding in px. */
  borderRadius?: number;

  // ─── Behaviour ─────────────────────────────────────────────────────────
  /** Show the conversation list when opening. Defaults to true. */
  showHistory?: boolean;
}

/** A message as rendered in the widget — distinct from the API's ChatMessage. */
interface WidgetMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

type View = 'list' | 'chat';

const DEFAULT_CONFIG: Partial<ChatWidgetConfig> = {
  position: 'bottom-right',
  primaryColor: '#7C3AED',
  onPrimaryColor: '#ffffff',
  buttonSize: 48,
  theme: 'light',
  zIndex: 2147483647,
  windowWidth: 400,
  windowHeight: 600,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontSize: 14,
  borderRadius: 12,
  inputPlaceholder: 'Type a message...',
  showHistory: true,
};

/** "just now" / "5m ago" / "3h ago" / "2d ago" / a date beyond a week. */
function relativeTime(seconds: number): string {
  if (!seconds) return '';
  const diff = Math.floor(Date.now() / 1000) - seconds;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(seconds * 1000).toLocaleDateString();
}

/**
 * ChatWidget — drop-in embeddable chat.
 *
 * Opens on the user's past conversations, with a "New chat" button beneath
 * them. Picking one loads its transcript; the header then offers back and
 * new-chat controls.
 *
 * Renders inside a Shadow DOM, so the host page's CSS cannot reach in and the
 * widget's cannot leak out. Everything visual is driven by CSS custom
 * properties, so theming is config rather than stylesheet overrides.
 */
export class ChatWidget {
  private config: Required<Pick<ChatWidgetConfig, 'apiKey' | 'baseUrl'>> & ChatWidgetConfig;
  private chat: XpectrumChat;
  private container: HTMLElement;
  private buttonEl: HTMLElement | null = null;
  private windowEl: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;

  private isOpen = false;
  private opened = false;
  private view: View = 'list';

  private threads: Thread[] = [];
  private threadsLoaded = false;
  private messages: WidgetMessage[] = [];
  private conversationId: string | null = null;
  private headerTitle: string;
  private greeting: string | undefined;

  private streaming = false;
  private currentTaskId: string | null = null;
  private abortCurrent: AbortController | null = null;

  constructor(config: ChatWidgetConfig) {
    // `buttonColor` predates `primaryColor` — honour it when the new one is absent
    const merged = { ...DEFAULT_CONFIG, ...config } as ChatWidgetConfig;
    if (config.buttonColor && !config.primaryColor) merged.primaryColor = config.buttonColor;

    this.config = merged as any;
    this.container = config.container || document.body;
    this.headerTitle = config.title || 'Chat';
    this.greeting = config.welcomeMessage;

    this.chat = new XpectrumChat({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      user: config.user,
      anonymousTtlDays: config.anonymousTtlDays,
    });

    this.conversationId = this.loadConversationId();
    this.mount();
  }

  // ─── Public ─────────────────────────────────────────────────────────────

  open(): void {
    if (!this.windowEl) return;
    this.windowEl.style.display = 'flex';
    this.isOpen = true;
    this.updateButtonIcon();

    if (!this.opened) {
      this.opened = true;
      this.loadAppConfig();
      this.config.showHistory ? this.openList() : this.startNewChat();
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
    const host = document.createElement('div');
    host.id = 'xpectrum-chat-widget-host';
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
        <button class="xp-header-btn xp-back-btn" title="Back" aria-label="Back">${this.getBackIcon()}</button>
        ${this.config.logo ? `<img class="xp-logo" src="${this.escapeAttr(this.config.logo)}" alt="" />` : ''}
        <span class="xp-chat-header-title">${this.escapeHtml(this.headerTitle)}</span>
        <button class="xp-header-btn xp-new-btn" title="New chat" aria-label="New chat">${this.getNewChatIcon()}</button>
        <button class="xp-header-btn xp-chat-close-btn" title="Close" aria-label="Close">${this.getCloseIcon()}</button>
      </div>

      <div class="xp-view xp-view-list">
        <div class="xp-thread-list"></div>
        <div class="xp-list-footer">
          <button class="xp-new-chat-btn">${this.getNewChatIcon()}<span>New chat</span></button>
        </div>
      </div>

      <div class="xp-view xp-view-chat">
        <div class="xp-chat-messages"></div>
        <div class="xp-chat-input-area">
          <textarea class="xp-chat-input" placeholder="${this.escapeAttr(this.config.inputPlaceholder || '')}" rows="1"></textarea>
          <button class="xp-chat-send-btn" title="Send" aria-label="Send">${this.getSendIcon()}</button>
        </div>
      </div>
    `;

    win.querySelector('.xp-chat-close-btn')?.addEventListener('click', () => this.close());
    win.querySelector('.xp-back-btn')?.addEventListener('click', () => this.openList());
    win.querySelector('.xp-new-btn')?.addEventListener('click', () => this.startNewChat());
    win.querySelector('.xp-new-chat-btn')?.addEventListener('click', () => this.startNewChat());

    const input = win.querySelector('.xp-chat-input') as HTMLTextAreaElement;
    const sendBtn = win.querySelector('.xp-chat-send-btn') as HTMLButtonElement;

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!this.streaming) this.handleSend(input);
      }
    });

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

  // ─── Private: Views ─────────────────────────────────────────────────────

  private setView(view: View): void {
    this.view = view;
    const win = this.windowEl;
    if (!win) return;

    (win.querySelector('.xp-view-list') as HTMLElement).style.display = view === 'list' ? 'flex' : 'none';
    (win.querySelector('.xp-view-chat') as HTMLElement).style.display = view === 'chat' ? 'flex' : 'none';

    // Back and new-chat only make sense inside a conversation, and only when
    // there is a list to go back to
    const inChat = view === 'chat';
    const canGoBack = inChat && !!this.config.showHistory;
    (win.querySelector('.xp-back-btn') as HTMLElement).style.display = canGoBack ? 'flex' : 'none';
    (win.querySelector('.xp-new-btn') as HTMLElement).style.display = inChat ? 'flex' : 'none';
  }

  /** Show the conversation list, refreshing it from the server. */
  private async openList(): Promise<void> {
    this.setView('list');
    this.renderThreads({ loading: !this.threadsLoaded });

    try {
      const page = await this.chat.listThreads({ limit: 30 });
      this.threads = page.data;
      this.threadsLoaded = true;

      // Nothing to show on a first visit — go straight into a new conversation
      if (!this.threads.length) {
        this.startNewChat();
        return;
      }
      this.renderThreads();
    } catch {
      this.renderThreads({ error: true });
    }
  }

  private async openThread(threadId: string): Promise<void> {
    this.conversationId = threadId;
    this.saveConversationId(threadId);
    this.messages = [];
    this.setView('chat');
    this.renderMessages({ loading: true });

    try {
      const page = await this.chat.getMessages(threadId, { limit: 50 });
      this.messages = page.data.map((m) => ({ id: m.id, role: m.role, content: m.content }));
      this.renderMessages();
    } catch {
      this.renderMessages({ error: true });
    }
  }

  private startNewChat(): void {
    this.conversationId = null;
    this.saveConversationId(null);
    this.messages = [];

    const greeting = this.greeting;
    if (greeting) this.messages.push({ id: 'welcome', role: 'assistant', content: greeting });

    this.setView('chat');
    this.renderMessages();
    (this.windowEl?.querySelector('.xp-chat-input') as HTMLTextAreaElement | null)?.focus();
  }

  /** Title and greeting come from the console, so they are configured once. */
  private async loadAppConfig(): Promise<void> {
    try {
      const appConfig = await this.chat.getConfig();
      if (!this.config.title && appConfig.appearance?.title) {
        this.headerTitle = appConfig.appearance.title;
        const el = this.windowEl?.querySelector('.xp-chat-header-title');
        if (el) el.textContent = this.headerTitle;
      }
      if (!this.greeting && appConfig.greeting) this.greeting = appConfig.greeting;
    } catch {
      // Config is optional — the embed's own values stand
    }
  }

  // ─── Private: Messaging ─────────────────────────────────────────────────

  private async handleSend(input: HTMLTextAreaElement): Promise<void> {
    const query = input.value.trim();
    if (!query) return;
    input.value = '';
    input.style.height = 'auto';

    this.messages.push({ id: `user-${Date.now()}`, role: 'user', content: query });

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

    if (result.conversationId) {
      const isNew = this.conversationId !== result.conversationId;
      this.conversationId = result.conversationId;
      this.saveConversationId(result.conversationId);
      // A new conversation won't be in the cached list yet
      if (isNew) this.threadsLoaded = false;
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
   * the second half the model keeps generating and consuming tokens.
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

  private updateSendButton(): void {
    const btn = this.windowEl?.querySelector('.xp-chat-send-btn') as HTMLButtonElement | null;
    if (!btn) return;
    btn.innerHTML = this.streaming ? this.getStopIcon() : this.getSendIcon();
    btn.setAttribute('aria-label', this.streaming ? 'Stop' : 'Send');
    btn.setAttribute('title', this.streaming ? 'Stop generating' : 'Send');
  }

  // ─── Private: Rendering ────────────────────────────────────────────────

  private renderThreads(state: { loading?: boolean; error?: boolean } = {}): void {
    const list = this.windowEl?.querySelector('.xp-thread-list');
    if (!list) return;

    if (state.error) {
      list.innerHTML = `<div class="xp-empty">Could not load your conversations.</div>`;
      return;
    }
    if (state.loading && !this.threads.length) {
      list.innerHTML = `<div class="xp-empty">Loading…</div>`;
      return;
    }
    if (!this.threads.length) {
      list.innerHTML = `<div class="xp-empty">No conversations yet.</div>`;
      return;
    }

    list.innerHTML = this.threads
      .map(
        (t) => `
      <button class="xp-thread" data-id="${this.escapeAttr(t.id)}">
        <span class="xp-thread-title">${this.escapeHtml(t.title || 'Untitled')}</span>
        <span class="xp-thread-time">${this.escapeHtml(relativeTime(t.updatedAt))}</span>
      </button>`,
      )
      .join('');

    list.querySelectorAll('.xp-thread').forEach((el) => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.id;
        if (id) this.openThread(id);
      });
    });
  }

  private renderMessages(state: { loading?: boolean; error?: boolean } = {}): void {
    const container = this.windowEl?.querySelector('.xp-chat-messages');
    if (!container) return;

    if (state.error) {
      container.innerHTML = `<div class="xp-empty">Could not load this conversation.</div>`;
      return;
    }
    if (state.loading) {
      container.innerHTML = `<div class="xp-empty">Loading…</div>`;
      return;
    }

    container.innerHTML = this.messages
      .map((msg) => {
        // Assistant replies are Markdown; what the user typed is literal text
        const body =
          msg.role === 'assistant' ? renderMarkdown(msg.content) : this.escapeHtml(msg.content);
        const cursor = msg.isStreaming ? '<span class="xp-typing-cursor">|</span>' : '';
        return `
      <div class="xp-msg xp-msg-${msg.role}">
        <div class="xp-msg-bubble xp-msg-bubble-${msg.role}">${body}${cursor}</div>
      </div>`;
      })
      .join('');

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

  /** Escape for use inside a double-quoted HTML attribute. */
  private escapeAttr(text: string): string {
    return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // ─── Private: Persistence ──────────────────────────────────────────────

  /**
   * Scoped per app and user, so two widgets on one page never collide.
   * Uses the client's resolved identity, which is the anonymous id when no
   * `user` was configured.
   */
  private storageKey(): string {
    return `xpectrum:thread:${this.config.baseUrl}:${this.chat.getUser()}`;
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

  // ─── Private: Icons ────────────────────────────────────────────────────

  private getChatIcon(): string {
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" fill="currentColor"/>
    </svg>`;
  }

  private getCloseIcon(): string {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  private getBackIcon(): string {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  private getNewChatIcon(): string {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
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
    const c = this.config;
    const dark = c.theme === 'dark';
    const size = c.fontSize || 14;
    const radius = c.borderRadius ?? 12;

    // Every rule below reads these, so theming is config rather than CSS overrides
    const tokens = `
      --xp-primary: ${c.primaryColor};
      --xp-on-primary: ${c.onPrimaryColor};
      --xp-bg: ${c.backgroundColor || (dark ? '#1a1a1a' : '#ffffff')};
      --xp-text: ${c.textColor || (dark ? '#f3f4f6' : '#1a1a1a')};
      --xp-muted: ${dark ? '#9ca3af' : '#6b7280'};
      --xp-surface: ${dark ? '#262626' : '#f9fafb'};
      --xp-border: ${dark ? '#374151' : '#e5e7eb'};
      --xp-font: ${c.fontFamily};
      --xp-size: ${size}px;
      --xp-radius: ${radius}px;
    `;

    return `
      :host { ${tokens} }

      * { box-sizing: border-box; }

      .xp-chat-button {
        position: fixed;
        ${c.position === 'bottom-left' ? 'left: 20px;' : 'right: 20px;'}
        bottom: 20px;
        width: ${c.buttonSize}px;
        height: ${c.buttonSize}px;
        border-radius: 50%;
        background: var(--xp-primary);
        color: var(--xp-on-primary);
        display: flex; align-items: center; justify-content: center;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: ${c.zIndex};
        transition: transform 0.15s ease;
      }
      .xp-chat-button:hover { transform: scale(1.05); }

      .xp-chat-window {
        position: fixed;
        ${c.position === 'bottom-left' ? 'left: 20px;' : 'right: 20px;'}
        bottom: ${(c.buttonSize || 48) + 32}px;
        width: ${c.windowWidth}px;
        max-width: calc(100vw - 40px);
        height: ${c.windowHeight}px;
        max-height: calc(100vh - 120px);
        background: var(--xp-bg);
        color: var(--xp-text);
        border-radius: var(--xp-radius);
        box-shadow: 0 8px 32px rgba(0,0,0,0.18);
        display: flex; flex-direction: column;
        overflow: hidden;
        z-index: ${c.zIndex};
        font-family: var(--xp-font);
        font-size: var(--xp-size);
      }

      .xp-chat-header {
        display: flex; align-items: center; gap: 8px;
        padding: 12px 12px 12px 14px;
        background: var(--xp-primary);
        color: var(--xp-on-primary);
        flex-shrink: 0;
      }
      .xp-logo { height: 22px; width: auto; max-width: 90px; object-fit: contain; border-radius: 4px; }
      .xp-chat-header-title {
        font-weight: 600;
        font-size: calc(var(--xp-size) + 1px);
        flex: 1;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .xp-header-btn {
        background: none; border: 0; padding: 4px;
        color: inherit; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        border-radius: 6px; opacity: 0.9;
      }
      .xp-header-btn:hover { opacity: 1; background: rgba(255,255,255,0.15); }

      .xp-view { flex: 1; display: flex; flex-direction: column; min-height: 0; }

      /* ─── Conversation list ─── */
      .xp-thread-list { flex: 1; overflow-y: auto; padding: 8px; }
      .xp-thread {
        display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
        width: 100%; text-align: left;
        padding: 10px 12px; margin-bottom: 4px;
        background: none; border: 0; border-radius: calc(var(--xp-radius) - 4px);
        cursor: pointer; font-family: inherit; color: var(--xp-text);
      }
      .xp-thread:hover { background: var(--xp-surface); }
      .xp-thread-title {
        font-size: var(--xp-size); font-weight: 500;
        max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .xp-thread-time { font-size: calc(var(--xp-size) - 3px); color: var(--xp-muted); }

      .xp-list-footer { padding: 10px; border-top: 1px solid var(--xp-border); flex-shrink: 0; }
      .xp-new-chat-btn {
        display: flex; align-items: center; justify-content: center; gap: 6px;
        width: 100%; padding: 10px;
        background: var(--xp-primary); color: var(--xp-on-primary);
        border: 0; border-radius: calc(var(--xp-radius) - 4px);
        font-family: inherit; font-size: var(--xp-size); font-weight: 500;
        cursor: pointer;
      }
      .xp-new-chat-btn:hover { opacity: 0.92; }

      .xp-empty {
        padding: 24px 16px; text-align: center;
        color: var(--xp-muted); font-size: calc(var(--xp-size) - 1px);
      }

      /* ─── Messages ─── */
      .xp-chat-messages { flex: 1; overflow-y: auto; padding: 16px; }
      .xp-chat-messages::-webkit-scrollbar,
      .xp-thread-list::-webkit-scrollbar { width: 4px; }
      .xp-chat-messages::-webkit-scrollbar-thumb,
      .xp-thread-list::-webkit-scrollbar-thumb { background: var(--xp-border); border-radius: 2px; }

      .xp-msg { display: flex; margin-bottom: 12px; }
      .xp-msg-user { justify-content: flex-end; }
      .xp-msg-assistant { justify-content: flex-start; }
      .xp-msg-bubble {
        max-width: 80%;
        padding: 10px 14px;
        border-radius: var(--xp-radius);
        line-height: 1.5;
        white-space: pre-wrap; word-wrap: break-word;
      }
      .xp-msg-bubble-user { background: var(--xp-primary); color: var(--xp-on-primary); }
      .xp-msg-bubble-assistant { background: var(--xp-surface); color: var(--xp-text); }
      .xp-typing-cursor { animation: xp-blink 1s step-end infinite; }
      @keyframes xp-blink { 50% { opacity: 0; } }

      /* ─── Rendered markdown ─── */
      .xp-md-p { margin: 0 0 8px; }
      .xp-md-p:last-child { margin-bottom: 0; }
      .xp-md-h { margin: 12px 0 6px; font-weight: 600; line-height: 1.3; }
      .xp-md-h:first-child { margin-top: 0; }
      h3.xp-md-h { font-size: calc(var(--xp-size) + 3px); }
      h4.xp-md-h { font-size: calc(var(--xp-size) + 1px); }
      h5.xp-md-h, h6.xp-md-h { font-size: var(--xp-size); }

      .xp-msg-bubble a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
      .xp-msg-bubble-assistant a { color: var(--xp-primary); }
      .xp-msg-bubble a:hover { opacity: 0.8; }

      .xp-md-list { margin: 0 0 8px; padding-left: 20px; }
      .xp-md-list:last-child { margin-bottom: 0; }
      .xp-md-list li { margin: 2px 0; }

      .xp-md-code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: calc(var(--xp-size) - 1px);
        background: rgba(127,127,127,0.18);
        padding: 1px 5px; border-radius: 4px;
      }
      .xp-md-pre {
        margin: 8px 0; padding: 10px 12px;
        background: rgba(127,127,127,0.14);
        border-radius: calc(var(--xp-radius) - 6px);
        overflow-x: auto;
      }
      .xp-md-pre:last-child { margin-bottom: 0; }
      .xp-md-pre code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: calc(var(--xp-size) - 1px);
        white-space: pre; background: none; padding: 0;
      }

      .xp-md-quote {
        margin: 8px 0; padding: 2px 0 2px 10px;
        border-left: 3px solid var(--xp-border);
        color: var(--xp-muted);
      }
      .xp-md-hr { margin: 12px 0; border: 0; border-top: 1px solid var(--xp-border); }

      /* Thumbnails — capped so a large image never blows out the bubble */
      .xp-md-img {
        max-width: 100%; max-height: 220px;
        width: auto; height: auto;
        border-radius: calc(var(--xp-radius) - 6px);
        margin: 6px 0; display: block;
      }

      /* ─── Input ─── */
      .xp-chat-input-area {
        display: flex; align-items: flex-end; gap: 8px;
        padding: 10px; border-top: 1px solid var(--xp-border);
        flex-shrink: 0;
      }
      .xp-chat-input {
        flex: 1; resize: none; max-height: 120px;
        padding: 10px 12px;
        border: 1px solid var(--xp-border);
        border-radius: calc(var(--xp-radius) - 4px);
        background: var(--xp-bg); color: var(--xp-text);
        font-family: inherit; font-size: var(--xp-size);
        line-height: 1.4; outline: none;
      }
      .xp-chat-input:focus { border-color: var(--xp-primary); }
      .xp-chat-send-btn {
        width: 36px; height: 36px; flex-shrink: 0;
        border: 0; border-radius: calc(var(--xp-radius) - 4px);
        background: var(--xp-primary); color: var(--xp-on-primary);
        display: flex; align-items: center; justify-content: center;
        cursor: pointer;
      }
      .xp-chat-send-btn:hover { opacity: 0.9; }
    `;
  }
}
