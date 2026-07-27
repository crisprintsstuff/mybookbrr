import fs from 'node:fs';
import path from 'node:path';
import { getSetCookieHeaders, httpRequest } from '../http.js';
import { getSetting } from '../db/index.js';

export interface QbitConfig {
  host: string;
  username: string;
  password: string;
  category?: string;
  savePath?: string;
}

interface SidCache {
  host: string;
  username: string;
  cookie: string;
}

let sidCache: SidCache | null = null;

export function getQbitConfig(): QbitConfig {
  return {
    host: (getSetting('qbit_host') || 'http://127.0.0.1:8080').replace(/\/$/, ''),
    username: getSetting('qbit_username') || 'admin',
    password: getSetting('qbit_password') || '',
    category: getSetting('qbit_category') || 'books',
    savePath: getSetting('qbit_save_path') || '',
  };
}

function invalidateSid(cfg: QbitConfig): void {
  if (
    sidCache &&
    sidCache.host === cfg.host &&
    sidCache.username === cfg.username
  ) {
    sidCache = null;
  }
}

/** Clear cached SID (tests / config change). */
export function clearQbitSession(): void {
  sidCache = null;
}

async function login(cfg: QbitConfig, force = false): Promise<string> {
  if (
    !force &&
    sidCache &&
    sidCache.host === cfg.host &&
    sidCache.username === cfg.username
  ) {
    return sidCache.cookie;
  }

  const body = new URLSearchParams({
    username: cfg.username,
    password: cfg.password,
  });
  const res = await httpRequest(`${cfg.host}/api/v2/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: cfg.host,
    },
    body: body.toString(),
    redirect: 0,
    timeoutMs: 8000,
  });
  const text = res.body.toString('utf8');
  if (res.statusCode !== 200 || text.trim() !== 'Ok.') {
    invalidateSid(cfg);
    throw new Error(`qBittorrent login failed (${res.statusCode}): ${text.slice(0, 120)}`);
  }
  const sid = getSetCookieHeaders(res.headers)
    .map((c) => c.split(';')[0])
    .find((c) => c.toLowerCase().startsWith('sid='));
  if (!sid) throw new Error('qBittorrent login succeeded but no SID cookie returned');
  sidCache = { host: cfg.host, username: cfg.username, cookie: sid };
  return sid;
}

function isAuthFailure(statusCode: number): boolean {
  return statusCode === 401 || statusCode === 403;
}

/** Run a SID-authenticated request; re-login once on 401/403. */
async function withSid(
  cfg: QbitConfig,
  run: (sid: string) => Promise<{ statusCode: number; body: Buffer }>
): Promise<{ statusCode: number; body: Buffer; sid: string }> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const sid = await login(cfg, attempt > 0);
    try {
      const res = await run(sid);
      if (isAuthFailure(res.statusCode)) {
        invalidateSid(cfg);
        lastErr = new Error(`qBittorrent auth expired (${res.statusCode})`);
        continue;
      }
      return { ...res, sid };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      // Connection blips: one short retry after fresh login
      invalidateSid(cfg);
    }
  }
  throw lastErr || new Error('qBittorrent request failed');
}

/** Soft check: is a torrent with this name already in the client? */
async function torrentListedByName(
  cfg: QbitConfig,
  sid: string,
  nameHint: string
): Promise<boolean> {
  const hint = nameHint.replace(/\.torrent$/i, '').trim().toLowerCase();
  if (!hint) return false;
  const needle = hint.slice(0, Math.min(hint.length, 48));
  const res = await httpRequest(`${cfg.host}/api/v2/torrents/info`, {
    headers: { Cookie: sid, Referer: cfg.host },
    timeoutMs: 8000,
  });
  if (res.statusCode !== 200) return false;
  try {
    const list = JSON.parse(res.body.toString('utf8')) as Array<{ name?: string }>;
    if (!Array.isArray(list)) return false;
    return list.some((t) => String(t.name || '').toLowerCase().includes(needle));
  } catch {
    return false;
  }
}

export async function testQbittorrent(
  cfg?: Partial<QbitConfig>
): Promise<{ ok: boolean; message: string; version?: string }> {
  const config: QbitConfig = { ...getQbitConfig(), ...cfg };
  if (!config.host) {
    return { ok: false, message: 'qBittorrent host is empty' };
  }
  try {
    const { statusCode, body } = await withSid(config, (sid) =>
      httpRequest(`${config.host}/api/v2/app/version`, {
        headers: { Cookie: sid, Referer: config.host },
        timeoutMs: 8000,
      })
    );
    if (statusCode !== 200) {
      return { ok: false, message: `Login OK but version check failed (${statusCode})` };
    }
    const version = body.toString('utf8').trim() || 'unknown';
    return { ok: true, message: `qBittorrent OK (${version})`, version };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: msg.includes('ECONNREFUSED')
        ? `Connection refused — is qBittorrent Web UI running at ${config.host}?`
        : msg.includes('ENOTFOUND')
          ? `Host not found: ${config.host}`
          : msg,
    };
  }
}

export async function addTorrentFile(
  torrentBuffer: Buffer,
  filename: string,
  opts: { category?: string; savePath?: string } = {},
  cfg?: QbitConfig
): Promise<{ ok: true; message: string }> {
  const config = cfg || getQbitConfig();
  const boundary = `----MyBookBRR${Date.now()}`;
  const category = opts.category || config.category || '';
  const savePath = opts.savePath || config.savePath || '';

  const parts: Buffer[] = [];
  const pushField = (name: string, value: string) => {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      )
    );
  };

  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="torrents"; filename="${filename}"\r\nContent-Type: application/x-bittorrent\r\n\r\n`
    )
  );
  parts.push(torrentBuffer);
  parts.push(Buffer.from('\r\n'));

  if (category) pushField('category', category);
  if (savePath) pushField('savepath', savePath);
  pushField('autoTMM', savePath ? 'false' : 'true');
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  const { statusCode, body: resBody, sid } = await withSid(config, (cookie) =>
    httpRequest(`${config.host}/api/v2/torrents/add`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Referer: config.host,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
      timeoutMs: 15000,
    })
  );

  const text = resBody.toString('utf8').trim();
  const lower = text.toLowerCase();
  if (statusCode === 200 && (lower === 'ok.' || lower === 'ok' || lower === '')) {
    // Optional verify: confirm it shows up (or already did). Soft — don't fail the snatch.
    const listed = await torrentListedByName(config, sid, filename).catch(() => true);
    return {
      ok: true,
      message: listed
        ? `Added to qBittorrent${category ? ` [${category}]` : ''}`
        : `Added to qBittorrent${category ? ` [${category}]` : ''} (pending list refresh)`,
    };
  }

  if (lower.includes('already') || lower.includes('duplicate')) {
    return { ok: true, message: `Already in qBittorrent${category ? ` [${category}]` : ''}` };
  }

  // One more soft path: add reported fail but torrent is already listed
  if (await torrentListedByName(config, sid, filename).catch(() => false)) {
    return { ok: true, message: `Already in qBittorrent${category ? ` [${category}]` : ''}` };
  }

  throw new Error(`qBittorrent add failed (${statusCode}): ${text.slice(0, 160)}`);
}

export function writeWatchFolder(
  torrentBuffer: Buffer,
  filename: string,
  watchDir?: string
): { ok: true; message: string; filePath: string } {
  const dir = watchDir || getSetting('watch_folder') || path.join(process.cwd(), 'downloads', 'watch');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, torrentBuffer);
  return { ok: true, message: `Wrote torrent to watch folder`, filePath };
}
