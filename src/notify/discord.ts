import { httpRequest } from '../http.js';
import { getSetting } from '../db/index.js';
import type { FilterRule, Release } from '../types.js';

const DISCORD_WEBHOOK_RE =
  /^https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/i;

export type DiscordEmbed = {
  title: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
};

function truncate(value: string, max = 1024): string {
  const s = value || '—';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function field(name: string, value: string, inline = true): { name: string; value: string; inline?: boolean } {
  return { name, value: truncate(value || '—', 1024), inline };
}

function isValidWebhook(url: string | null | undefined): url is string {
  return Boolean(url && DISCORD_WEBHOOK_RE.test(url.trim()));
}

function releaseFields(release: Release, extras: Array<{ name: string; value: string; inline?: boolean }> = []) {
  const fields = [
    field('Author', release.author || 'Unknown'),
    field('Series', release.series || 'Standalone'),
    field('Narrator', release.narrator || '—'),
    field('Media / Format', `${release.mediaType || '—'} / ${release.format || '—'}`),
    field('Size', release.sizeStr || (release.sizeMB ? `${release.sizeMB} MB` : '—')),
    field(
      'Flags',
      [release.freeleech ? 'Freeleech' : null, release.vip ? 'VIP' : null, release.bitrate ? `${release.bitrate} kbps` : null]
        .filter(Boolean)
        .join(' · ') || '—'
    ),
    field('Source', release.source || '—'),
    field('Torrent ID', release.torrentId || '—'),
    ...extras,
  ];
  if (release.category) fields.push(field('Category', release.category));
  if (release.year) fields.push(field('Year', release.year));
  return fields;
}

export async function sendDiscordWebhook(
  webhookUrl: string,
  embed: DiscordEmbed,
  username = 'MyBookBRR'
): Promise<void> {
  if (!isValidWebhook(webhookUrl)) return;
  const res = await httpRequest(webhookUrl.trim(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      embeds: [
        {
          title: truncate(embed.title, 256),
          description: embed.description ? truncate(embed.description, 4096) : undefined,
          url: embed.url,
          color: embed.color ?? 0x2d6a4f,
          fields: (embed.fields || []).slice(0, 25),
          footer: embed.footer || { text: 'MyBookBRR • MyAnonamouse' },
          timestamp: embed.timestamp || new Date().toISOString(),
        },
      ],
    }),
    timeoutMs: 8000,
  });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`Discord webhook HTTP ${res.statusCode}: ${res.body.toString('utf8').slice(0, 160)}`);
  }
}

function webhookSetting(...keys: string[]): string {
  for (const key of keys) {
    const v = (getSetting(key) || '').trim();
    if (isValidWebhook(v)) return v;
  }
  return '';
}

/** Live announce / release stream (IRC + new wishlist finds). */
export async function notifyReleaseStream(release: Release): Promise<void> {
  const webhook = webhookSetting('discord_webhook_stream', 'discord_webhook_url');
  if (!webhook) return;
  try {
    await sendDiscordWebhook(
      webhook,
      {
        title: release.title || 'New release',
        url: release.torrentUrl || undefined,
        color: 0x3b82f6,
        description: 'Release stream',
        fields: releaseFields(release),
        footer: { text: 'MyBookBRR • Release stream' },
      },
      'MyBookBRR Stream'
    );
  } catch (err) {
    console.warn('[Discord] stream webhook failed:', err instanceof Error ? err.message : err);
  }
}

/** Snatch success — per-filter webhook overrides global snatch webhook. */
export async function notifySnatchSuccess(
  release: Release,
  filter: FilterRule | null,
  detail: string,
  opts: { category?: string; savePath?: string; clientType?: string } = {}
): Promise<void> {
  const webhook =
    (filter?.discordWebhookUrl || '').trim() ||
    webhookSetting('discord_webhook_snatch', 'discord_webhook_url');
  if (!webhook) return;
  try {
    await sendDiscordWebhook(
      webhook,
      {
        title: release.title || 'Snatched release',
        url: release.torrentUrl || undefined,
        color: 0x2d6a4f,
        description: 'Snatch success',
        fields: releaseFields(release, [
          field('Filter', filter?.name || 'manual'),
          field('Client', opts.clientType || getSetting('download_client') || 'qbittorrent'),
          field('Category', opts.category || filter?.clientCategory || getSetting('qbit_category') || '—'),
          field('Save path', opts.savePath || filter?.savePath || getSetting('qbit_save_path') || '—', false),
          field('Detail', detail || 'OK', false),
        ]),
        footer: { text: filter?.discordWebhookUrl ? `MyBookBRR • Filter: ${filter.name}` : 'MyBookBRR • Snatch' },
      },
      'MyBookBRR Snatch'
    );
  } catch (err) {
    console.warn('[Discord] snatch webhook failed:', err instanceof Error ? err.message : err);
  }
}

/** Errors during snatch / download / client push. */
export async function notifySnatchError(
  release: Release,
  filterName: string | null,
  error: string
): Promise<void> {
  const webhook = webhookSetting('discord_webhook_errors', 'discord_webhook_url');
  if (!webhook) return;
  try {
    await sendDiscordWebhook(
      webhook,
      {
        title: release.title || 'Snatch error',
        url: release.torrentUrl || undefined,
        color: 0x9b2226,
        description: 'Snatch / download error',
        fields: releaseFields(release, [
          field('Filter', filterName || '—'),
          field('Error', error || 'Unknown error', false),
        ]),
        footer: { text: 'MyBookBRR • Errors' },
      },
      'MyBookBRR Errors'
    );
  } catch (err) {
    console.warn('[Discord] error webhook failed:', err instanceof Error ? err.message : err);
  }
}

/** Generic system/error embed (non-release). */
export async function notifySystemError(event: string, message: string, component = 'MyBookBRR'): Promise<void> {
  const webhook = webhookSetting('discord_webhook_errors', 'discord_webhook_url');
  if (!webhook) return;
  try {
    await sendDiscordWebhook(
      webhook,
      {
        title: event || 'System error',
        color: 0x9b2226,
        fields: [
          field('Details', message || '—', false),
          field('Component', component),
        ],
        footer: { text: 'MyBookBRR • Errors' },
      },
      'MyBookBRR Errors'
    );
  } catch (err) {
    console.warn('[Discord] system webhook failed:', err instanceof Error ? err.message : err);
  }
}

/** @deprecated use notifySnatchSuccess / notifySnatchError */
export async function notifySnatch(
  release: Release,
  filterName: string | null,
  success: boolean,
  detail: string
): Promise<void> {
  if (success) {
    await notifySnatchSuccess(release, filterName ? ({ name: filterName, discordWebhookUrl: '' } as FilterRule) : null, detail);
  } else {
    await notifySnatchError(release, filterName, detail);
  }
}

export type DiscordWebhookChannel = 'stream' | 'errors' | 'snatch';

const SAMPLE_RELEASE: Release = {
  torrentId: '0',
  title: 'MyBookBRR webhook test',
  author: 'Test Author',
  series: 'Test Series #1',
  narrator: 'Test Narrator',
  mediaType: 'eBook',
  format: 'EPUB',
  sizeMB: 1.23,
  sizeStr: '1.23 MiB',
  freeleech: true,
  vip: false,
  bitrate: 0,
  torrentUrl: 'https://www.myanonamouse.net/',
  source: 'manual',
  raw: 'webhook-test',
  year: '2026',
  category: 'E-Books',
};

/**
 * Send a sample embed to a webhook URL (form value or saved setting).
 * Does not persist settings.
 */
export async function testDiscordWebhook(
  channel: DiscordWebhookChannel,
  urlOverride?: string,
  filterLabel?: string
): Promise<{ ok: boolean; message: string }> {
  const settingKey =
    channel === 'stream'
      ? 'discord_webhook_stream'
      : channel === 'errors'
        ? 'discord_webhook_errors'
        : 'discord_webhook_snatch';
  const url = (urlOverride || getSetting(settingKey) || getSetting('discord_webhook_url') || '').trim();
  if (!url) {
    return { ok: false, message: `No webhook URL for ${channel}. Paste a URL and try again (Save to persist).` };
  }
  if (!isValidWebhook(url)) {
    return {
      ok: false,
      message: 'Invalid Discord webhook URL (expected https://discord.com/api/webhooks/…)',
    };
  }

  try {
    if (channel === 'stream') {
      await sendDiscordWebhook(
        url,
        {
          title: SAMPLE_RELEASE.title,
          url: SAMPLE_RELEASE.torrentUrl,
          color: 0x3b82f6,
          description: 'Test: release stream webhook',
          fields: releaseFields(SAMPLE_RELEASE),
          footer: { text: 'MyBookBRR • Release stream (test)' },
        },
        'MyBookBRR Stream'
      );
    } else if (channel === 'errors') {
      await sendDiscordWebhook(
        url,
        {
          title: SAMPLE_RELEASE.title,
          url: SAMPLE_RELEASE.torrentUrl,
          color: 0x9b2226,
          description: 'Test: errors webhook',
          fields: releaseFields(SAMPLE_RELEASE, [field('Error', 'This is a test error embed', false)]),
          footer: { text: 'MyBookBRR • Errors (test)' },
        },
        'MyBookBRR Errors'
      );
    } else {
      const label = filterLabel || 'Webhook Test';
      await sendDiscordWebhook(
        url,
        {
          title: SAMPLE_RELEASE.title,
          url: SAMPLE_RELEASE.torrentUrl,
          color: 0x2d6a4f,
          description: 'Test: snatch success webhook',
          fields: releaseFields(SAMPLE_RELEASE, [
            field('Filter', label),
            field('Client', 'qbittorrent'),
            field('Detail', 'Test snatch embed — ignore', false),
          ]),
          footer: { text: `MyBookBRR • Filter snatch (test): ${label}` },
        },
        'MyBookBRR Snatch'
      );
    }
    return { ok: true, message: `Test ${channel} embed sent. Check Discord.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
