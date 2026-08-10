/**
 * A stable, unguessable identifier for a visitor who has not logged in.
 *
 * Why not an IP address: addresses are shared behind NAT — an office, a café,
 * a mobile carrier — so everyone on one connection would land in the same
 * conversation history and read each other's chats. They also change when a
 * network changes, silently losing history, and count as personal data.
 *
 * A random id avoids all three. It is unique per browser, survives until it
 * expires or storage is cleared, and cannot be guessed: 122 bits of randomness
 * means nobody can enumerate `/threads?user=…` to find someone else's history.
 */

const PREFIX = 'anon_';
const DEFAULT_TTL_DAYS = 30;

interface StoredId {
  id: string;
  /** Epoch ms after which the id is discarded and a new one issued. */
  expires: number;
}

/** Per-process fallback for environments with no storage (Node, private mode). */
const memory = new Map<string, StoredId>();

function uuid(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();

  // Older browsers: build a v4 UUID from getRandomValues
  if (c?.getRandomValues) {
    const bytes = c.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // No crypto at all — not unguessable, but nothing better is available
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function read(key: string): StoredId | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as StoredId;
  } catch {
    // Storage unavailable or holding malformed JSON — fall through to memory
  }
  return memory.get(key) || null;
}

function write(key: string, value: StoredId): void {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Non-fatal — the id just will not survive a reload
  }
}

/**
 * Return this visitor's anonymous id, creating one if needed.
 *
 * The expiry slides: every call pushes it out again, so an active visitor keeps
 * their history and a dormant one is forgotten. Scoped by `namespace` (the API
 * base URL) so two apps on one page never share an identity.
 */
export function getAnonymousId(namespace: string, ttlDays: number = DEFAULT_TTL_DAYS): string {
  const key = `xpectrum:anon:${namespace}`;
  const ttlMs = Math.max(0, ttlDays) * 86_400_000;
  const now = Date.now();

  const stored = read(key);
  if (stored?.id && stored.expires > now) {
    write(key, { id: stored.id, expires: now + ttlMs });
    return stored.id;
  }

  const id = `${PREFIX}${uuid()}`;
  write(key, { id, expires: now + ttlMs });
  return id;
}

/** Forget the current anonymous id so the next call issues a fresh one. */
export function clearAnonymousId(namespace: string): void {
  const key = `xpectrum:anon:${namespace}`;
  memory.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to do — memory copy is already gone
  }
}
