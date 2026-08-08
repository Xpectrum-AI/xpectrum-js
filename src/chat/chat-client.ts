import { HttpClient, XpectrumApiError } from '../core/http-client';
import { parseSSEStream } from '../core/sse-parser';
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
 * chatbot, agent and chatflow apps alike.
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

  // ─── Requests ───────────────────────────────────────────────────────────

  private buildBody(prompt: Prompt, options: ChatOptions, stream: boolean): Record<string, any> {
    const body: Record<string, any> = {
      model: options.model || this.config.model || DEFAULT_MODEL,
      messages: toMessages(prompt),
      stream,
    };

    // Xpectrum extension fields — ignored by standard OpenAI clients
    const inputs = options.inputs || this.config.inputs;
    if (inputs) body.inputs = inputs;
    if (this.config.user) body.user = this.config.user;
    if (options.conversationId) body.conversation_id = options.conversationId;
    if (options.files?.length) body.files = options.files;
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
          if (chunk.conversation_id) result.conversationId = chunk.conversation_id;
          if (chunk.task_id) result.taskId = chunk.task_id;
          if (chunk.usage) result.usage = chunk.usage;
          if (chunk.retriever_resources) result.retrieverResources = chunk.retriever_resources;
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
      conversationId: raw.conversation_id,
      messageId: raw.id?.replace(/^chatcmpl-/, ''),
      taskId: raw.task_id,
      usage: raw.usage,
      retrieverResources: raw.retriever_resources,
      finishReason: choice?.finish_reason || undefined,
    };
  }

  // ─── Models ─────────────────────────────────────────────────────────────

  /** List the models this API key can reach. */
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
