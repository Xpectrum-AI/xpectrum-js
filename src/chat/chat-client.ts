import { HttpClient, XpectrumApiError } from '../core/http-client';
import { parseSSEStream } from '../core/sse-parser';
import { getAnonymousId, clearAnonymousId } from '../core/anonymous-id';
import type {
  XpectrumChatConfig,
  Prompt,
  ChatMessage,
  ChatOptions,
  StreamOptions,
  SendOptions,
  ChatResult,
  ChatError,
  ModelInfo,
  ModelListResponse,
  RawStreamChunk,
  RawCompletion,
  Thread,
  ThreadMessage,
  ThreadListOptions,
  MessageListOptions,
  Page,
  AgentInfo,
  Suggestions,
  RawThread,
  RawThreadMessage,
  RawPage,
  RawSuggestions,
} from './types';

const DEFAULT_MODEL = 'xpectrum';

function toMessages(prompt: Prompt): ChatMessage[] {
  return typeof prompt === 'string' ? [{ role: 'user', content: prompt }] : prompt;
}

/**
 * XpectrumChat — chat client for Xpectrum AI.
 *
 * Streaming is the default because agent apps only support streaming; `send()`
 * streams under the hood and resolves with the finished reply, so it works for
 * chatbot, agent and flow apps alike.
 *
 * @example
 * ```ts
 * const chat = new XpectrumChat({
 *   baseUrl: 'https://app.yourserver.com/v1',
 *   apiKey: 'app-xxxxxxxxxxxx',
 *   user: 'user-123',
 * });
 *
 * // Promise style
 * const res = await chat.send('Hello!');
 * console.log(res.content);
 *
 * // Token by token
 * await chat.stream('Tell me a story', {
 *   onToken: (delta, full) => render(full),
 * });
 * ```
 */
export class XpectrumChat {
  private http: HttpClient;
  private config: XpectrumChatConfig;
  private activeControllers = new Set<AbortController>();

  constructor(config: XpectrumChatConfig) {
    this.config = config;
    this.http = new HttpClient({
      baseUrl: config.baseUrl,
      authMode: 'bearer',
      authValue: config.apiKey,
    });
  }

  // ─── Identity ───────────────────────────────────────────────────────────

  /**
   * The identifier every request is attributed to — the configured `user`, or
   * a persisted anonymous id when none was given.
   */
  getUser(): string {
    return this.config.user || getAnonymousId(this.config.baseUrl, this.config.anonymousTtlDays);
  }

  /**
   * Forget the anonymous identity and issue a new one, so the next request
   * starts with an empty history. Use it for "clear my history" or on logout.
   *
   * Does nothing when `user` was configured explicitly — that identity is
   * yours to change, not the SDK's.
   */
  resetUser(): void {
    if (this.config.user) return;
    clearAnonymousId(this.config.baseUrl);
  }

  // ─── Requests ───────────────────────────────────────────────────────────

  private buildBody(prompt: Prompt, options: ChatOptions, stream: boolean): Record<string, any> {
    const body: Record<string, any> = {
      model: options.model || this.config.model || DEFAULT_MODEL,
      messages: toMessages(prompt),
      stream,
    };

    // Xpectrum extension fields — ignored by standard OpenAI clients
    const variables =
      options.variables || this.config.variables
        ? { ...(this.config.variables || {}), ...(options.variables || {}) }
        : undefined;
    if (variables) body.variables = variables;
    body.user = this.getUser();
    if (options.threadId) body.thread_id = options.threadId;
    if (options.attachments?.length) body.attachments = options.attachments;
    if (options.channel) body.channel = options.channel;
    if (options.channelMetadata) body.channel_metadata = options.channelMetadata;
    if (options.timezone) body.timezone = options.timezone;

    return body;
  }

  /**
   * Stream a reply token by token. Resolves with the assembled result once the
   * stream closes.
   *
   * Errors go to `onError` if you supply it; otherwise they are thrown, so
   * promise-style callers never receive a silently empty result.
   */
  async stream(prompt: Prompt, options: StreamOptions = {}): Promise<ChatResult> {
    const controller = new AbortController();
    this.activeControllers.add(controller);
    options.getAbortController?.(controller);
    options.signal?.addEventListener('abort', () => controller.abort());

    const result: ChatResult = { content: '' };
    let failure: ChatError | undefined;
    let caught: unknown;

    const fail = (error: ChatError) => {
      failure = error;
      options.onError?.(error);
    };

    try {
      const response = await this.http.streamPost(
        '/chat/completions',
        this.buildBody(prompt, options, true),
        controller.signal,
      );

      await parseSSEStream<RawStreamChunk>(response, {
        onEvent: (chunk) => {
          // Mid-stream failures arrive as an OpenAI error object
          if (chunk.error) {
            fail({
              message: chunk.error.message || 'Generation failed.',
              code: chunk.error.code || chunk.error.type,
            });
            return;
          }

          if (chunk.model) result.model = chunk.model;
          if (chunk.thread_id) result.threadId = chunk.thread_id;
          if (chunk.run_id) result.runId = chunk.run_id;
          if (chunk.usage) result.usage = chunk.usage;
          if (chunk.citations) result.citations = chunk.citations;
          // Chunk ids are formatted `chatcmpl-<message_id>`
          if (chunk.id) result.messageId = chunk.id.replace(/^chatcmpl-/, '');

          const choice = chunk.choices?.[0];
          if (!choice) return;
          if (choice.finish_reason) result.finishReason = choice.finish_reason;

          const delta = choice.delta?.content;
          if (delta) {
            result.content += delta;
            options.onToken?.(delta, result.content);
          }
        },
        onError: (error) => fail({ message: error.message }),
      });
    } catch (error: any) {
      // An intentional abort is not a failure — return whatever arrived
      if (error.name === 'AbortError') return result;
      caught = error;
      fail({
        message: error.message || 'Failed to send message',
        code: error.code,
        status: error.status,
      });
    } finally {
      this.activeControllers.delete(controller);
    }

    if (failure) {
      // With no onError handler the caller is using promise style — surface it
      if (!options.onError) {
        throw (
          caught ??
          new XpectrumApiError({
            code: failure.code || 'stream_error',
            message: failure.message,
            status: failure.status ?? 0,
          })
        );
      }
      return result;
    }

    options.onDone?.(result);
    return result;
  }

  /**
   * Send a message and resolve with the complete reply.
   *
   * Streams internally by default so it works for chatbot, agent and chatflow
   * apps alike. Pass `blocking: true` for a single non-streaming request — the
   * API rejects that for agent apps.
   */
  async send(prompt: Prompt, options: SendOptions = {}): Promise<ChatResult> {
    if (!options.blocking) {
      return this.stream(prompt, options);
    }

    const raw = await this.http.post<RawCompletion>(
      '/chat/completions',
      this.buildBody(prompt, options, false),
      { signal: options.signal },
    );

    const choice = raw.choices?.[0];
    return {
      content: choice?.message?.content || '',
      model: raw.model,
      threadId: raw.thread_id,
      messageId: raw.id?.replace(/^chatcmpl-/, ''),
      runId: raw.run_id,
      mode: raw.mode,
      usage: raw.usage,
      citations: raw.citations,
      finishReason: choice?.finish_reason || undefined,
    };
  }

  // ─── History ────────────────────────────────────────────────────────────

  /**
   * List past conversations, most recently updated first.
   *
   * Titles are generated server-side, so they are ready to show in a sidebar.
   * To page further back, pass the previous page's `lastId` as `after`.
   */
  async listThreads(options: ThreadListOptions = {}): Promise<Page<Thread>> {
    const res = await this.http.get<RawPage<RawThread>>(
      '/threads',
      { user: this.getUser(), limit: options.limit, after: options.after },
      { signal: options.signal },
    );

    return {
      data: (res.data || []).map((t) => ({
        id: t.id,
        title: t.title || '',
        createdAt: t.created_at || 0,
        updatedAt: t.updated_at || 0,
      })),
      hasMore: !!res.has_more,
      limit: res.limit ?? 0,
      firstId: res.first_id ?? undefined,
      lastId: res.last_id ?? undefined,
    };
  }

  /**
   * Load one conversation's transcript, oldest message first.
   *
   * To page further back, pass the previous page's `firstId` as `before`.
   */
  async getMessages(threadId: string, options: MessageListOptions = {}): Promise<Page<ThreadMessage>> {
    const res = await this.http.get<RawPage<RawThreadMessage>>(
      `/threads/${threadId}/messages`,
      { user: this.getUser(), limit: options.limit, before: options.before },
      { signal: options.signal },
    );

    return {
      data: (res.data || []).map((m) => ({
        id: m.id,
        threadId: m.thread_id || threadId,
        role: m.role || 'assistant',
        content: m.content || '',
        createdAt: m.created_at || 0,
        citations: m.citations,
        error: m.error,
      })),
      hasMore: !!res.has_more,
      limit: res.limit ?? 0,
      firstId: res.first_id ?? undefined,
      lastId: res.last_id ?? undefined,
    };
  }

  // ─── Control ────────────────────────────────────────────────────────────

  /**
   * Stop an in-flight reply on the server.
   *
   * Aborting the stream client-side only stops *reading* it — the model keeps
   * generating and keeps consuming tokens until this is called. Pass the
   * `runId` from a `ChatResult` or from `onDone`.
   */
  async cancel(runId: string): Promise<void> {
    await this.http.post(`/runs/${runId}/cancel`, { user: this.getUser() });
  }

  // ─── Suggestions ────────────────────────────────────────────────────────

  /**
   * Follow-up questions the user is likely to ask next, generated from the
   * thread so far. Costs one model call, so ask only when about to show them.
   *
   * `messageId` is the assistant message to follow on from — `messageId` on a
   * `ChatResult`, or an assistant message id from `getMessages()`. Requires
   * the agent's follow-up suggestions feature to be enabled.
   */
  async getSuggestions(messageId: string, options: { signal?: AbortSignal } = {}): Promise<Suggestions> {
    const raw = await this.http.get<RawSuggestions>(
      `/messages/${messageId}/suggestions`,
      { user: this.getUser() },
      { signal: options.signal },
    );
    return { messageId: raw.message_id || messageId, questions: raw.data || [] };
  }

  // ─── Agent info ─────────────────────────────────────────────────────────

  /**
   * Describe the agent behind this API key — name, title, greeting and starter
   * questions — so a client can render itself from what was configured in the
   * console rather than hardcoding it.
   */
  async getAgent(options: { signal?: AbortSignal } = {}): Promise<AgentInfo> {
    const res = await this.http.get<ModelListResponse>('/models', undefined, { signal: options.signal });
    const m = res.data?.[0];
    if (!m) {
      throw new XpectrumApiError({ code: 'model_not_found', message: 'No agent behind this API key.', status: 404 });
    }
    return {
      id: m.id,
      name: m.name || '',
      description: m.description || '',
      mode: m.mode,
      title: m.title || m.name || '',
      greeting: m.greeting || undefined,
      starterQuestions: m.starter_questions || [],
    };
  }

  // ─── Models ─────────────────────────────────────────────────────────────

  /** OpenAI-style model list. The single entry is the agent behind this key. */
  async listModels(): Promise<ModelInfo[]> {
    const res = await this.http.get<ModelListResponse>('/models');
    return res.data || [];
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────

  /** Abort every in-flight stream started by this client. */
  destroy(): void {
    for (const controller of this.activeControllers) {
      controller.abort();
    }
    this.activeControllers.clear();
  }
}
