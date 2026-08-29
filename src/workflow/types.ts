import type { Attachment } from '../chat/types';

// ─── Workflow Configuration ─────────────────────────────────────────────────

export interface XpectrumWorkflowConfig {
  /** Base URL of the Xpectrum API — the "API Server" value shown in the console */
  baseUrl: string;
  /** API key of a **workflow** app — used as Bearer token */
  apiKey: string;
  /** Who runs are attributed to. Defaults to an anonymous per-browser id. */
  user?: string;
  anonymousTtlDays?: number;
}

// ─── Requests ───────────────────────────────────────────────────────────────

export interface RunOptions {
  /** The workflow's input variables. */
  variables: Record<string, any>;
  attachments?: Attachment[];
  signal?: AbortSignal;
  getAbortController?: (controller: AbortController) => void;
}

export interface RunStreamOptions extends RunOptions {
  onStart?: (event: RunStarted) => void;
  onStepStart?: (step: Step) => void;
  onStepComplete?: (step: Step) => void;
  onDone?: (run: Run) => void;
  onError?: (error: { message: string; code?: string; status?: number }) => void;
}

// ─── Responses ──────────────────────────────────────────────────────────────

export type RunStatus = 'running' | 'succeeded' | 'failed' | 'stopped' | string;

export interface Run {
  id: string;
  status?: RunStatus;
  variables?: Record<string, any> | null;
  outputs?: Record<string, any> | null;
  error?: string | null;
  steps?: number;
  tokens?: number;
  elapsedSeconds?: number;
  createdAt?: number;
  finishedAt?: number;
}

export interface RunStarted {
  id: string;
  createdAt?: number;
}

export interface Step {
  id: string;
  title?: string;
  type?: string;
  index?: number;
  createdAt?: number;
  // Only on `step.completed`
  status?: string;
  outputs?: Record<string, any> | null;
  error?: string | null;
  elapsedSeconds?: number;
}

// ─── Wire formats (internal) ────────────────────────────────────────────────

export interface RawRun {
  id?: string;
  object?: string;
  status?: string;
  variables?: Record<string, any> | null;
  outputs?: Record<string, any> | null;
  error?: string | null;
  steps?: number;
  tokens?: number;
  elapsed_seconds?: number;
  created_at?: number;
  finished_at?: number;
}

export interface RawRunEvent extends RawRun {
  object?: 'run.started' | 'step.started' | 'step.completed' | 'run.completed' | string;
  title?: string;
  type?: string;
  index?: number;
  error?: string | null;
  // present only on error chunks
  message?: string;
  code?: string;
}

export interface RawRunChunk extends RawRunEvent {
  // Error chunks come as `{ error: { message, type, code } }`
  error?: any;
}
