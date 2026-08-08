// ─── HTTP Client Types ──────────────────────────────────────────────────────

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: Record<string, any> | FormData | null;
  params?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  rawBody?: boolean;
  timeout?: number;
}

export interface ApiError {
  code: string;
  message: string;
  status: number;
}

// ─── Event Emitter ──────────────────────────────────────────────────────────

export type EventHandler<T = any> = (data: T) => void;
export type UnsubscribeFn = () => void;
