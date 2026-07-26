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

export function getQbitConfig(): QbitConfig {
  return {
    host: (getSetting('qbit_host') || 'http://127.0.0.1:8080').replace(/\/$/, ''),
    username: getSetting('qbit_username') || 'admin',
    password: getSetting('qbit_password') || '',
    category: getSetting('qbit_category') || 'books',
    savePath: getSetting('qbit_save_path') || '',
  };
}

async function login(cfg: QbitConfig): Promise<string> {
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
    throw new Error(`qBittorrent login failed (${res.statusCode}): ${text.slice(0, 120)}`);
  }
  const sid = getSetCookieHeaders(res.headers)
    .map((c) => c.split(';')[0])
    .find((c) => c.toLowerCase().startsWith('sid='));
  if (!sid) throw new Error('qBittorrent login succeeded but no SID cookie returned');
  return sid;
}

export async function testQbittorrent(cfg?: Partial<QbitConfig>): Promise<{ ok: boolean; message: string; version?: string }> {
  const config: QbitConfig = { ...getQbitConfig(), ...cfg };
  if (!config.host) {
    return { ok: false, message: 'qBittorrent host is empty' };
  }
  try {
    const sid = await login(config);
    const res = await httpRequest(`${config.host}/api/v2/app/version`, {
      headers: { Cookie: sid },
      timeoutMs: 8000,
    });
    if (res.statusCode !== 200) {
      return { ok: false, message: `Login OK but version check failed (${res.statusCode})` };
    }
    const version = res.body.toString('utf8').trim() || 'unknown';
    return { ok: true, message: `qBittorrent OK (${version})`, version };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: msg.includes('ECONNREFUSED')
      ? `Connection refused — is qBittorrent Web UI running at ${config.host}?`
      : msg.includes('ENOTFOUND')
        ? `Host not found: ${config.host}`
        : msg };
  }
}

export async function addTorrentFile(
  torrentBuffer: Buffer,
  filename: string,
  opts: { category?: string; savePath?: string } = {},
  cfg?: QbitConfig
): Promise<{ ok: true; message: string }> {
  const config = cfg || getQbitConfig();
  const sid = await login(config);

  const boundary = `----Newbookbot${Date.now()}`;
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
  const res = await httpRequest(`${config.host}/api/v2/torrents/add`, {
    method: 'POST',
    headers: {
      Cookie: sid,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
  const text = res.body.toString('utf8').trim();
  if (res.statusCode !== 200 || (text && text.toLowerCase() !== 'ok.' && text.toLowerCase() !== 'ok')) {
    throw new Error(`qBittorrent add failed (${res.statusCode}): ${text.slice(0, 160)}`);
  }
  return { ok: true, message: `Added to qBittorrent${category ? ` [${category}]` : ''}` };
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
