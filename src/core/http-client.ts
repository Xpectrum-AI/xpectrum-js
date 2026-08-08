import type { RequestOptions, ApiError } from './types';

const DEFAULT_TIMEOUT = 30_000;

export class XpectrumApiError extends Error {
  code: string;
  status: number;

  constructor(error: ApiError) {
    super(error.message);
    this.name = 'XpectrumApiError';
    this.code = error.code;
    this.status = error.status;
  }
}

/**
 * Normalize an error response body into an ApiError. Handles both the native
 * `{ code, message, status }` shape and the OpenAI-compatible
 * `{ error: { message, type, code } }` shape.
 */
async function toApiError(response: Response, fallbackCode = 'unknown_error'): Promise<ApiError> {
  let payload: any;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  const fallbackMessage = `HTTP ${response.status}: ${response.statusText}`;

  if (payload?.error && typeof payload.error === 'object') {
    return {
      code: payload.error.code || payload.error.type || fallbackCode,
      message: payload.error.message || fallbackMessage,
      status: response.status,
    };
  }

  if (payload?.message || payload?.code) {
    return {
      code: payload.code || fallbackCode,
      message: payload.message || fallbackMessage,
      status: payload.status || response.status,
    };
  }

  return { code: fallbackCode, message: fallbackMessage, status: response.status };
}

export interface HttpClientConfig {
  baseUrl: string;
  /** Use 'api-key' for voice server (x-api-key header), 'bearer' for chat server */
  authMode: 'api-key' | 'bearer';
  /** The API key or Bearer token value */
  authValue: string;
}

export class HttpClient {
  private baseUrl: string;
  private authMode: 'api-key' | 'bearer';
  private authValue: string;

  constructor(config: HttpClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.authMode = config.authMode;
    this.authValue = config.authValue;
  }

  updateAuthValue(value: string): void {
    this.authValue = value;
  }

  private getAuthHeaders(): Record<string, string> {
    if (this.authMode === 'api-key') {
      return { 'x-api-key': this.authValue };
    }
    return { Authorization: `Bearer ${this.authValue}` };
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    // Concatenate baseUrl + path (baseUrl may include a path like /api/v1)
    const fullUrl = this.baseUrl + (path.startsWith('/') ? path : `/${path}`);
    const url = new URL(fullUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  async request<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', headers = {}, body, params, signal, rawBody, timeout = DEFAULT_TIMEOUT } = options;

    const url = this.buildUrl(path, params);

    const mergedHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.getAuthHeaders(),
      ...headers,
    };

    if (rawBody || body instanceof FormData) {
      delete mergedHeaders['Content-Type'];
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
    }

    try {
      const response = await fetch(url, {
        method,
        headers: mergedHeaders,
        body: body
          ? rawBody || body instanceof FormData
            ? (body as BodyInit)
            : JSON.stringify(body)
          : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new XpectrumApiError(await toApiError(response));
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return (await response.json()) as T;
      }

      return response as unknown as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  get<T = any>(path: string, params?: Record<string, string | number | boolean | undefined>, options?: Omit<RequestOptions, 'method' | 'params'>): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET', params });
  }

  post<T = any>(path: string, body?: Record<string, any> | null, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  patch<T = any>(path: string, body?: Record<string, any> | null, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PATCH', body });
  }

  delete<T = any>(path: string, options?: Omit<RequestOptions, 'method'>): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }

  /**
   * POST request that returns a raw SSE stream Response.
   */
  async streamPost(path: string, body: Record<string, any>, signal?: AbortSignal): Promise<Response> {
    const url = this.buildUrl(path);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders(),
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      throw new XpectrumApiError(await toApiError(response, 'stream_error'));
    }

    return response;
  }
}
