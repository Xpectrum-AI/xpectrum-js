export interface SSECallbacks<T = any> {
  onEvent: (data: T) => void;
  /** Fired when the server sends the `[DONE]` sentinel that closes the stream. */
  onDone?: () => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
}

/**
 * Parses a ReadableStream of Server-Sent Events from a fetch Response.
 *
 * Network chunks do not align with line boundaries, so a single `data:` line can
 * arrive split across two reads — the trailing partial line is buffered until
 * the rest of it shows up.
 */
export async function parseSSEStream<T = any>(
  response: Response,
  callbacks: SSECallbacks<T>,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is not readable');
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const handleLine = (trimmed: string): void => {
    // Skip blank lines and comments (keep-alive pings arrive as `: ping`)
    if (!trimmed || trimmed.startsWith(':')) return;
    if (!trimmed.startsWith('data: ')) return;

    const payload = trimmed.slice(6);

    // End-of-stream sentinel — not JSON
    if (payload === '[DONE]') {
      callbacks.onDone?.();
      return;
    }

    try {
      callbacks.onEvent(JSON.parse(payload) as T);
    } catch {
      // Not valid JSON — could be a partial line, skip
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      // Keep the last, potentially incomplete, line for the next read
      buffer = lines.pop() || '';

      for (const line of lines) {
        handleLine(line.trim());
      }
    }

    if (buffer.trim()) {
      handleLine(buffer.trim());
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      // Stream was intentionally aborted
      return;
    }
    callbacks.onError?.(error as Error);
  } finally {
    reader.releaseLock();
    callbacks.onClose?.();
  }
}
