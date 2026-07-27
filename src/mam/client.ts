import { getSetCookieHeaders, httpRequest } from '../http.js';
import { getSetting, setSetting } from '../db/index.js';
import type { MamDownloadResult, MamSearchParams, MamSearchResult } from './types.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export const UNSATISFIED_LIMIT_MESSAGE =
  'MAM download blocked: unsatisfied torrent limit. Seed existing torrents to clear the limit.';

export class UnsatisfiedLimitError extends Error {
  readonly code = 'MAM_UNSATISFIED_LIMIT' as const;
  constructor(message = UNSATISFIED_LIMIT_MESSAGE) {
    super(message);
    this.name = 'UnsatisfiedLimitError';
  }
}

export function isUnsatisfiedLimitError(err: unknown): boolean {
  if (err instanceof UnsatisfiedLimitError) return true;
  const msg = err instanceof Error ? err.message : String(err || '');
  return /unsatisfied (torrent )?limit/i.test(msg);
}

function normalizeMamId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('mam_id=')) {
    return trimmed.replace(/^mam_id=/i, '').replace(/;$/, '').trim();
  }
  return trimmed.replace(/;$/, '').trim();
}

function cookieHeader(mamId: string): string {
  const id = normalizeMamId(mamId);
  return `mam_id=${id};`;
}

function extractMamIdFromSetCookie(setCookie: string[]): string | null {
  for (const h of setCookie) {
    const match = h.match(/mam_id=([^;]+)/i);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

export function getMamId(): string {
  return normalizeMamId(getSetting('mam_id'));
}

export function persistMamId(mamId: string): void {
  const normalized = normalizeMamId(mamId);
  if (!normalized) return;
  if (normalized !== getMamId()) {
    setSetting('mam_id', normalized);
    console.log('[MAM] Persisted rotated mam_id cookie');
  }
}

async function mamFetch(
  url: string,
  options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ statusCode: number; body: Buffer }> {
  const mamId = getMamId();
  if (!mamId) throw new Error('Missing mam_id cookie. Set it in Settings (dedicated MAM security session).');

  const res = await httpRequest(url, {
    method: options.method || 'GET',
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, application/x-bittorrent, text/html, */*',
      Cookie: cookieHeader(mamId),
      ...options.headers,
    },
    body: options.body,
  });

  const rotated = extractMamIdFromSetCookie(getSetCookieHeaders(res.headers));
  if (rotated) persistMamId(rotated);

  return { statusCode: res.statusCode, body: res.body };
}

function buildSearchUrl(params: MamSearchParams): string {
  const url = new URL('https://www.myanonamouse.net/tor/js/loadSearchJSONbasic.php');
  const textParts = [params.text, params.author, params.title, params.series, params.narrator]
    .filter(Boolean)
    .map(String);
  if (textParts.length) {
    url.searchParams.set('tor[text]', textParts.join(' '));
  }
  url.searchParams.set('tor[srchIn][title]', 'true');
  url.searchParams.set('tor[srchIn][author]', 'true');
  url.searchParams.set('tor[srchIn][narrator]', 'true');
  url.searchParams.set('tor[srchIn][series]', 'true');
  url.searchParams.set('tor[searchType]', params.searchIn || 'all');
  url.searchParams.set('tor[searchIn]', 'torrents');
  url.searchParams.set('tor[browseFlagsHideVsDefault]', '0');
  url.searchParams.set('tor[startNumber]', String(params.startNumber ?? 0));
  url.searchParams.set('perpage', String(params.perPage ?? 50));
  url.searchParams.set('tor[sortType]', params.sortType || 'dateDesc');

  if (params.mainCat !== undefined) {
    const cats = Array.isArray(params.mainCat) ? params.mainCat : [params.mainCat];
    for (const c of cats) {
      url.searchParams.append('tor[main_cat][]', String(c));
    }
  }

  return url.toString();
}

export async function searchTorrents(params: MamSearchParams = {}): Promise<MamSearchResult> {
  const url = buildSearchUrl(params);
  const res = await mamFetch(url);
  const text = res.body.toString('utf8');

  if (res.statusCode === 401 || /not signed in|login/i.test(text.slice(0, 500))) {
    throw new Error('MAM search failed: not signed in (invalid or expired mam_id)');
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`MAM search returned non-JSON (${res.statusCode}): ${text.slice(0, 120)}`);
  }

  const obj = json as Record<string, unknown>;
  const data = (obj.data || obj.torrents || obj.results || []) as MamSearchResult['data'];
  return {
    data: Array.isArray(data) ? data : [],
    total: Number(obj.total || obj.found || (Array.isArray(data) ? data.length : 0)),
    found: Number(obj.found || obj.total || 0),
    raw: json,
  };
}

function isBencode(buf: Buffer): boolean {
  if (buf.length < 20) return false;
  if (buf[0] === 0x64 /* d */) return true;
  return buf.slice(0, 20).toString('utf8').includes('d8:announce');
}

export async function downloadTorrent(torrentId: string): Promise<MamDownloadResult> {
  if (!torrentId) throw new Error('Missing torrent ID');
  const url = `https://www.myanonamouse.net/tor/download.php?tid=${torrentId}`;
  const res = await mamFetch(url, {
    headers: {
      Accept: 'application/x-bittorrent, */*',
    },
  });

  if (isBencode(res.body)) {
    const filename = `MAM_${torrentId}.torrent`;
    // Keep the torrent in memory only. qBittorrent gets the buffer via API;
    // watch-folder mode writes its own copy under the configured watch dir.
    return {
      success: true,
      torrentId,
      filename,
      sizeBytes: res.body.length,
      buffer: res.body,
    };
  }

  const html = res.body.toString('utf8');
  const clean = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (/unsatisfied limit/i.test(html)) {
    throw new UnsatisfiedLimitError();
  }
  if (/Invalid download link|not signed in/i.test(html) || /not signed in/i.test(clean)) {
    throw new Error('MAM download failed: invalid mam_id cookie or not signed in.');
  }
  throw new Error(`MAM download failed (${res.statusCode}): ${clean.slice(0, 160) || 'unknown error'}`);
}

export async function testMamSession(): Promise<{ ok: boolean; message: string }> {
  try {
    const result = await searchTorrents({ text: '', perPage: 1, startNumber: 0 });
    return {
      ok: true,
      message: `MAM session OK (${result.data.length} sample result(s))`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
