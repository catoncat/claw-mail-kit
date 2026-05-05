export class HttpError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export function json(data: unknown, status = 200, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, status, headers });
}

export function notFound(): Response {
  return json({ ok: false, error: 'not found' }, 404);
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json({ ok: false, error: error.message, code: error.code }, error.status);
  }
  const message = error instanceof Error ? error.message : String(error);
  return json({ ok: false, error: message }, 500);
}

export async function readJson<T = Record<string, unknown>>(request: Request, maxBytes = 64 * 1024): Promise<T> {
  const len = request.headers.get('content-length');
  if (len && Number(len) > maxBytes) throw new HttpError(413, 'request body too large');
  const text = await request.text();
  if (!text.trim()) return {} as T;
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new HttpError(413, 'request body too large');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'invalid JSON body');
  }
}

export function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `missing ${name}`);
  return value.trim();
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function asArray(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parsePositiveInt(value: unknown, fallback: number, max = 100): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

export function parseBooleanFlag(value: string | null): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}
