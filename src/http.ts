import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

export interface HttpResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

export async function httpRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Buffer;
    redirect?: number;
    timeoutMs?: number;
  } = {}
): Promise<HttpResponse> {
  const redirectsLeft = options.redirect ?? 5;
  const timeoutMs = options.timeoutMs ?? 10000;
  const parsed = new URL(url);
  const lib = parsed.protocol === 'http:' ? http : https;
  const body = options.body;

  const res = await new Promise<HttpResponse>((resolve, reject) => {
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method || 'GET',
        headers: {
          ...options.headers,
          ...(body ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode || 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        });
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms (${parsed.host})`));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });

  if (
    redirectsLeft > 0 &&
    res.statusCode >= 301 &&
    res.statusCode <= 308 &&
    res.headers.location
  ) {
    const loc = Array.isArray(res.headers.location) ? res.headers.location[0] : res.headers.location;
    if (loc) {
      const next = loc.startsWith('http') ? loc : `${parsed.protocol}//${parsed.host}${loc}`;
      return httpRequest(next, { ...options, redirect: redirectsLeft - 1 });
    }
  }

  return res;
}

export function getSetCookieHeaders(headers: http.IncomingHttpHeaders): string[] {
  const raw = headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}
