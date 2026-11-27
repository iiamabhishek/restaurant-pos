import { GatewayError } from './adapter';

export interface HttpOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

/**
 * One place for outbound calls: bounded time, no redirects followed (a
 * redirect would resend credentials elsewhere) and error text that never
 * echoes a request header or body, so a secret cannot reach logs or the UI.
 */
export async function gatewayFetch<T>(
  url: string,
  opts: HttpOptions = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: opts.headers,
      body: opts.body,
      redirect: 'error',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
  } catch {
    throw new GatewayError('The payment provider could not be reached');
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const message =
      providerMessage(json) ?? `The provider answered HTTP ${res.status}`;
    // A rate limit or a server error says nothing about whether the request
    // was processed: the provider may have taken the money/refund before the
    // connection broke. Per the adapter contract, only a *definite* rejection
    // carries a status; ambiguous answers must not let callers finalise a
    // failure and release a refund hold that is still needed.
    if (res.status === 429 || res.status >= 500) {
      throw new GatewayError(message);
    }
    throw new GatewayError(message, res.status);
  }
  return json as T;
}

interface ProviderErrorShape {
  error?: { description?: unknown; message?: unknown };
  message?: unknown;
}

function providerMessage(json: unknown): string | null {
  const j = (json ?? {}) as ProviderErrorShape;
  const m =
    j.error?.description ?? // Razorpay
    j.error?.message ?? // Stripe
    j.message; // Cashfree
  return typeof m === 'string' ? m.slice(0, 200) : null;
}

export function basicAuth(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}
