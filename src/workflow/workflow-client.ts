import { HttpClient, XpectrumApiError } from '../core/http-client';
import { parseSSEStream } from '../core/sse-parser';
import { getAnonymousId } from '../core/anonymous-id';
import type {
  XpectrumWorkflowConfig,
  RunOptions,
  RunStreamOptions,
  Run,
  Step,
  RawRun,
  RawRunChunk,
} from './types';

function toRun(raw: RawRun, fallbackId?: string): Run {
  return {
    id: raw.id || fallbackId || '',
    status: raw.status,
    variables: raw.variables,
    outputs: raw.outputs,
    error: typeof raw.error === 'string' ? raw.error : raw.error ?? null,
    steps: raw.steps,
    tokens: raw.tokens,
    elapsedSeconds: raw.elapsed_seconds,
    createdAt: raw.created_at,
    finishedAt: raw.finished_at,
  };
}

function toStep(raw: RawRunChunk): Step {
  return {
    id: raw.id || '',
    title: raw.title,
    type: raw.type,
    index: raw.index,
    createdAt: raw.created_at,
    status: raw.status,
    outputs: raw.outputs,
    error: typeof raw.error === 'string' ? raw.error : raw.error ?? null,
    elapsedSeconds: raw.elapsed_seconds,
  };
}

/**
 * XpectrumWorkflow — run a **workflow** app.
 *
 * Chatbot, agent and flow apps are driven through `XpectrumChat`; this client
 * is for apps whose API key belongs to a pure workflow.
 *
 * @example
 * ```ts
 * const wf = new XpectrumWorkflow({ baseUrl, apiKey });
 * const run = await wf.run({ variables: { topic: 'pricing' } });
 * console.log(run.outputs);
 * ```
 */
export class XpectrumWorkflow {
  private http: HttpClient;
  private config: XpectrumWorkflowConfig;
  private activeControllers = new Set<AbortController>();

  constructor(config: XpectrumWorkflowConfig) {
    this.config = config;
    this.http = new HttpClient({
      baseUrl: config.baseUrl,
      authMode: 'bearer',
      authValue: config.apiKey,
    });
  }

  getUser(): string {
    return this.config.user || getAnonymousId(this.config.baseUrl, this.config.anonymousTtlDays);
  }

  private buildBody(options: RunOptions, stream: boolean): Record<string, any> {
    const body: Record<string, any> = {
      variables: options.variables || {},
      stream,
      user: this.getUser(),
    };
    if (options.attachments?.length) body.attachments = options.attachments;
    return body;
  }

  /** Run the workflow and resolve with the finished run. */
  async run(options: RunOptions): Promise<Run> {
    const raw = await this.http.post<RawRun>('/runs', this.buildBody(options, false), {
      signal: options.signal,
    });
    return toRun(raw);
  }

  /**
   * Run the workflow and follow its progress: `onStart` → `onStepStart` /
   * `onStepComplete` per node → `onDone` with the finished run.
   *
   * Errors go to `onError` if you supply it; otherwise they are thrown.
   */
  async stream(options: RunStreamOptions): Promise<Run> {
    const controller = new AbortController();
    this.activeControllers.add(controller);
    options.getAbortController?.(controller);
    options.signal?.addEventListener('abort', () => controller.abort());

    let run: Run = { id: '' };
    let failure: { message: string; code?: string; status?: number } | undefined;
    let caught: unknown;

    const fail = (error: { message: string; code?: string; status?: number }) => {
      failure = error;
      options.onError?.(error);
    };

    try {
      const response = await this.http.streamPost('/runs', this.buildBody(options, true), controller.signal);

      await parseSSEStream<RawRunChunk>(response, {
        onEvent: (chunk) => {
          if (chunk.error && typeof chunk.error === 'object') {
            fail({
              message: chunk.error.message || 'Run failed.',
              code: chunk.error.code || chunk.error.type,
            });
            return;
          }
          switch (chunk.object) {
            case 'run.started':
              run.id = chunk.id || run.id;
              options.onStart?.({ id: run.id, createdAt: chunk.created_at });
              break;
            case 'step.started':
              options.onStepStart?.(toStep(chunk));
              break;
            case 'step.completed':
              options.onStepComplete?.(toStep(chunk));
              break;
            case 'run.completed':
              run = toRun(chunk, run.id);
              break;
          }
        },
        onError: (error) => fail({ message: error.message }),
      });
    } catch (error: any) {
      if (error.name === 'AbortError') return run;
      caught = error;
      fail({ message: error.message || 'Run failed.', code: error.code, status: error.status });
    } finally {
      this.activeControllers.delete(controller);
    }

    if (failure) {
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
      return run;
    }

    options.onDone?.(run);
    return run;
  }

  /**
   * Stop a run in progress on the server. Pass the run `id` from `onStart`
   * or the `Run` result.
   */
  async cancel(runId: string): Promise<void> {
    await this.http.post(`/runs/${runId}/cancel`, { user: this.getUser() });
  }

  /** Abort every in-flight stream started by this client. */
  destroy(): void {
    for (const controller of this.activeControllers) controller.abort();
    this.activeControllers.clear();
  }
}
