import type { MamSearchHit } from '../mam/types.js';
import type { MediaType, Release, WishlistWatch } from '../types.js';

function parseInfoMap(info: string | Record<string, unknown> | undefined): string {
  if (!info) return '';
  if (typeof info === 'string') {
    try {
      const parsed = JSON.parse(info) as Record<string, unknown>;
      return Object.values(parsed)
        .map(String)
        .filter(Boolean)
        .join(', ');
    } catch {
      return info;
    }
  }
  return Object.values(info)
    .map(String)
    .filter(Boolean)
    .join(', ');
}

function parseSizeMB(size: string | number | undefined): { sizeMB: number; sizeStr: string } {
  if (typeof size === 'number') {
    const mb = size / (1024 * 1024);
    return { sizeMB: mb, sizeStr: `${mb.toFixed(1)} MB` };
  }
  if (!size) return { sizeMB: 0, sizeStr: 'Unknown Size' };
  const m = String(size).match(/([0-9.]+)\s*(MiB|GiB|KiB|TiB|MB|GB|KB|TB)?/i);
  if (!m) return { sizeMB: 0, sizeStr: String(size) };
  const val = parseFloat(m[1]);
  const unit = (m[2] || 'MB').toUpperCase();
  let sizeMB = val;
  if (unit.startsWith('G')) sizeMB = val * 1024;
  else if (unit.startsWith('K')) sizeMB = val / 1024;
  else if (unit.startsWith('T')) sizeMB = val * 1024 * 1024;
  return { sizeMB, sizeStr: `${val} ${unit}` };
}

function detectMediaAndFormat(hit: MamSearchHit): { mediaType: MediaType; format: string } {
  const cat = String(hit.catname || hit.category || '').toLowerCase();
  const filetype = String(hit.filetype || '').toUpperCase();
  const title = String(hit.title || '');
  const audio = /audio/.test(cat) || /\b(M4B|MP3|FLAC|AAC)\b/i.test(filetype) || /\b(M4B|MP3)\b/i.test(title);
  if (audio) {
    const fmt = filetype.match(/\b(M4B|MP3|FLAC|AAC|WMA|M4A|OGG)\b/i)?.[1]?.toUpperCase()
      || title.match(/\b(M4B|MP3|FLAC|AAC)\b/i)?.[1]?.toUpperCase()
      || 'M4B';
    return { mediaType: 'Audiobook', format: fmt };
  }
  const fmt = filetype.match(/\b(EPUB|MOBI|AZW3|PDF|CBR|CBZ)\b/i)?.[1]?.toUpperCase()
    || title.match(/\b(EPUB|MOBI|AZW3|PDF)\b/i)?.[1]?.toUpperCase()
    || (filetype.split('/')[0] || 'EPUB').toUpperCase();
  return { mediaType: 'eBook', format: fmt };
}

export function mamHitToRelease(hit: MamSearchHit, source: Release['source'] = 'wishlist'): Release | null {
  const id = String(hit.id ?? hit['tid'] ?? '');
  if (!id) return null;
  const { mediaType, format } = detectMediaAndFormat(hit);
  const { sizeMB, sizeStr } = parseSizeMB(hit.size as string | number | undefined);
  const author = parseInfoMap(hit.author_info) || String(hit.author || 'Unknown Author');
  const narrator = parseInfoMap(hit.narrator_info) || String(hit.narrator || (mediaType === 'Audiobook' ? 'Unknown Narrator' : 'N/A'));
  const series = parseInfoMap(hit.series_info as string | Record<string, unknown>) || String(hit.series || 'Standalone');
  const bitrateMatch = String(hit.bitrate || '').match(/(\d+)/);
  const freeleech = Boolean(hit.freefile === true || hit.freefile === 1 || hit.freefile === '1' || hit.freefile === 'yes');
  const vip = Boolean(hit.vip === true || hit.vip === 1 || hit.vip === '1' || hit.vip === 'yes');

  return {
    torrentId: id,
    title: String(hit.title || 'Unknown Title'),
    author,
    series: series || 'Standalone',
    narrator,
    mediaType,
    format,
    sizeMB,
    sizeStr,
    freeleech,
    vip,
    bitrate: bitrateMatch ? parseInt(bitrateMatch[1], 10) : 0,
    torrentUrl: `https://www.myanonamouse.net/t/${id}`,
    source,
    raw: JSON.stringify(hit),
    category: String(hit.catname || hit.category || ''),
  };
}

export function watchMatchesRelease(watch: WishlistWatch, release: Release): boolean {
  if (watch.mediaTypes?.length && !watch.mediaTypes.includes(release.mediaType)) return false;
  if (watch.formats?.length) {
    const ok = watch.formats.some((f) => f.toUpperCase() === release.format.toUpperCase());
    if (!ok) return false;
  }
  if (watch.author) {
    if (!release.author.toLowerCase().includes(watch.author.toLowerCase())) return false;
  }
  if (watch.series) {
    const hay = `${release.series} ${release.title}`.toLowerCase();
    if (!hay.includes(watch.series.toLowerCase())) return false;
  }
  if (watch.narrator) {
    if (!release.narrator.toLowerCase().includes(watch.narrator.toLowerCase())) return false;
  }
  if (watch.query) {
    const hay = `${release.title} ${release.author} ${release.series} ${release.narrator}`.toLowerCase();
    if (!hay.includes(watch.query.toLowerCase())) return false;
  }
  return true;
}

export function mediaTypesToMainCats(mediaTypes: string[]): number[] {
  const cats: number[] = [];
  if (!mediaTypes.length || mediaTypes.includes('Audiobook')) cats.push(13);
  if (!mediaTypes.length || mediaTypes.includes('eBook')) cats.push(14);
  return cats.length ? cats : [13, 14];
}
