import type { Release, ReleaseSource } from '../types.js';

export function parseAnnouncementLine(
  rawLine: string,
  source: ReleaseSource = 'irc'
): Release | null {
  if (!rawLine || typeof rawLine !== 'string') return null;

  if (
    /^(?::[^\s]+\s+)?(?:001|002|003|004|005|251|254|255|265|266|332|333|353|366|372|375|376|396|401|421|433|451|464|900|903)\b/i.test(
      rawLine
    ) ||
    /You have not registered|PRIVMSG NickServ|PRIVMSG HostServ|PRIVMSG ChanServ|AUTHENTICATE|CAP END/i.test(
      rawLine
    )
  ) {
    return null;
  }

  let cleanLine = rawLine.replace(/^@[^\s]+\s+/, '');
  cleanLine = cleanLine
    .replace(/\x03(?:\d{1,2}(?:,\d{1,2})?)?/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim();
  cleanLine = cleanLine.replace(/^(?::[^\s]+\s+)?PRIVMSG\s+[^\s]+\s+:\s*/i, '').trim();
  cleanLine = cleanLine.replace(/^(?:[a-zA-Z0-9_|-]+[:>]\s*)+/, '').trim();

  let title = '';
  let author = '';
  let series = 'Standalone';
  let year = new Date().getFullYear().toString();
  let format = 'EPUB';
  let mediaType: Release['mediaType'] = 'eBook';
  let narrator = 'N/A';
  let bitrate = 0;
  let freeleech = false;
  let vip = false;
  let sizeStr = '0 MB';
  let sizeMB = 0;
  let torrentUrl = '';
  let categoryName = '';
  let torrentId = '';

  const catHeaderMatch = cleanLine.match(/(?:Category:\s*(?:\(\s*)?|NEW\s+in\s+|\[)([^:|\)\]\n]+)/i);
  if (catHeaderMatch) categoryName = catHeaderMatch[1].trim();

  if (/freeleech:\s*(yes|1|true)|\[FL\]|\bfreeleech\b/i.test(cleanLine)) freeleech = true;
  if (/vip:\s*(yes|1|true)|\[VIP\]|\bvip\b/i.test(cleanLine)) vip = true;

  const urlMatch = cleanLine.match(/https?:\/\/[^\s"]+/i) || cleanLine.match(/\/t\/\d+/i);
  if (urlMatch) {
    const rawUrl = urlMatch[0];
    const matchId = rawUrl.match(/(?:\/t\/|\/tor\/|id=|tid=)(\d+)/i);
    if (matchId) {
      torrentId = matchId[1];
      torrentUrl = `https://www.myanonamouse.net/t/${torrentId}`;
    } else {
      torrentUrl = rawUrl.startsWith('http')
        ? rawUrl.replace(/myanonymouse\.net/gi, 'myanonamouse.net')
        : `https://www.myanonamouse.net${rawUrl}`;
    }
  } else {
    const directIdMatch = cleanLine.match(/\b(\d{5,8})\b/);
    if (directIdMatch) {
      torrentId = directIdMatch[1];
      torrentUrl = `https://www.myanonamouse.net/t/${torrentId}`;
    }
  }

  const sizeMatch = cleanLine.match(
    /(?:size:\s*|\(\s*|\[)?([0-9.]+)\s*(MiB|GiB|KiB|TiB|MB|GB|KB|TB|Bytes?)\b/i
  );
  if (sizeMatch) {
    const val = parseFloat(sizeMatch[1]);
    const unit = sizeMatch[2].toUpperCase();
    sizeStr = `${val} ${unit}`;
    if (unit.startsWith('G')) sizeMB = val * 1024;
    else if (unit.startsWith('K')) sizeMB = val / 1024;
    else if (unit.startsWith('T')) sizeMB = val * 1024 * 1024;
    else sizeMB = val;
  }

  if (
    /\b(M4B|MP3|FLAC|AAC|WMA|M4A|OGG)\b/i.test(cleanLine) ||
    /audiobook|narrat/i.test(cleanLine) ||
    /audio/i.test(categoryName)
  ) {
    mediaType = 'Audiobook';
    const fmtMatch = cleanLine.match(/\b(M4B|MP3|FLAC|AAC|WMA|M4A|OGG)\b/i);
    format = fmtMatch ? fmtMatch[1].toUpperCase() : 'M4B';
  } else if (
    /\b(EPUB|MOBI|AZW3|PDF|CBR|CBZ)\b/i.test(cleanLine) ||
    /ebook|book/i.test(cleanLine) ||
    /book|ebook/i.test(categoryName)
  ) {
    mediaType = 'eBook';
    const fmtMatch = cleanLine.match(/\b(EPUB|MOBI|AZW3|PDF|CBR|CBZ)\b/i);
    format = fmtMatch ? fmtMatch[1].toUpperCase() : 'EPUB';
  }

  const bitrateMatch = cleanLine.match(/(\d+)\s*kbps/i);
  if (bitrateMatch) bitrate = parseInt(bitrateMatch[1], 10);

  const narratorMatch = cleanLine.match(/(?:narrator|read by|narrated by):\s*([^|\-\[\n]+)/i);
  if (narratorMatch) narrator = narratorMatch[1].trim();

  const yearMatch = cleanLine.match(/\[(\d{4})\]/) || cleanLine.match(/\b(19\d\d|20\d\d)\b/);
  if (yearMatch) year = yearMatch[1];

  if (cleanLine.includes('|')) {
    for (const seg of cleanLine.split('|')) {
      const kv = seg.split(':');
      if (kv.length < 2) continue;
      const key = kv[0].trim().toLowerCase();
      const val = kv.slice(1).join(':').trim();
      if (key.includes('title') || key.includes('name')) {
        const parts = val.split(' - ');
        if (parts.length >= 2) {
          author = parts[0].trim();
          let titlePart = parts.slice(1).join(' - ').trim();
          const sMatch = titlePart.match(/([^(]+)\s*\(([^)]+)\)/);
          if (sMatch) {
            title = sMatch[1].trim();
            series = sMatch[2].trim();
          } else {
            title = titlePart.replace(/\[[^\]]+\]/g, '').trim();
          }
        } else {
          title = val.replace(/\[[^\]]+\]/g, '').trim();
        }
      } else if (key.includes('author')) author = val;
      else if (key.includes('narrator')) narrator = val;
    }
  }

  if (!author || !title) {
    const quoteMatch = cleanLine.match(/"([^"]+)"/);
    if (quoteMatch) {
      const inside = quoteMatch[1];
      const parts = inside.split(' - ');
      if (parts.length >= 2) {
        author = parts[0].trim();
        let rest = parts.slice(1).join(' - ').trim();
        const sMatch = rest.match(/([^(]+)\s*\(([^)]+)\)/);
        if (sMatch) {
          title = sMatch[1].trim();
          series = sMatch[2].trim();
        } else {
          title = rest.replace(/\[[^\]]+\]/g, '').trim();
        }
      } else {
        title = inside.replace(/\[[^\]]+\]/g, '').trim();
      }
    }
  }

  if (!author && cleanLine.includes(' by ')) {
    const byParts = cleanLine.split(' by ');
    title = byParts[0].replace(/NEW:\s*/i, '').replace(/"/g, '').trim();
    author = byParts[1].split('[')[0].split('-')[0].trim();
  }

  if (!author || author === 'Unknown Author') {
    if (/New\s+Torrent:/i.test(cleanLine) || (cleanLine.includes(' By: ') && cleanLine.includes('Category:'))) {
      const norm = cleanLine.replace(/^New\s+Torrent:\s*/i, '').trim();
      const catMatch = norm.match(/Category:\s*(?:\(\s*)?([^\]\)\n|]+)/i);
      if (catMatch) {
        categoryName = catMatch[1].trim();
        if (/audio/i.test(categoryName)) {
          mediaType = 'Audiobook';
          if (format === 'EPUB') format = 'M4B';
        } else if (/book|ebook/i.test(categoryName)) {
          mediaType = 'eBook';
        }
      }
      const byMatch = norm.match(/(.*?)\s+By:\s+(.*)/i);
      if (byMatch) {
        const rawTitle = byMatch[1].trim();
        const rawRest = byMatch[2].trim();
        const sMatch = rawTitle.match(/([^(]+)\s*\(([^)]+)\)/);
        if (sMatch) {
          title = sMatch[1].trim();
          series = sMatch[2].trim();
        } else {
          title = rawTitle;
        }
        author = rawRest.split(/Category:|Narrator:|Size:|Link:|- https?:/i)[0].trim().replace(/^by:\s*/i, '');
        const narMatch = rawRest.match(/Narrator:\s*([^|Category:\n]+)/i);
        if (narMatch) narrator = narMatch[1].trim();
      }
    }
  }

  const stripCategoryPrefix = (str: string) =>
    (str || '')
      .replace(/^NEW\s+in\s+[^:]+:\s*/i, '')
      .replace(/^NEW:\s*/i, '')
      .replace(/^Category:\s*[^|]+\|\s*/i, '')
      .replace(/^(?::[^\s]+\s+)?PRIVMSG\s+[^\s]+\s+:\s*/i, '')
      .replace(/^(?:[a-zA-Z0-9_|-]+[:>]\s*)+/, '')
      .trim();

  if (!author || author === 'Unknown Author') {
    const strippedLine = stripCategoryPrefix(cleanLine);
    const hyphenParts = strippedLine.split(' - ');
    if (hyphenParts.length >= 2) {
      author = stripCategoryPrefix(hyphenParts[0]).replace(/"/g, '').trim();
      const titlePart = hyphenParts[1].split('[')[0].trim();
      const sMatch = titlePart.match(/([^(]+)\s*\(([^)]+)\)/);
      if (sMatch) {
        title = sMatch[1].trim();
        series = sMatch[2].trim();
      } else {
        title = titlePart.trim();
      }
    } else {
      title = strippedLine.slice(0, 60);
      author = 'Unknown Author';
    }
  }

  author = stripCategoryPrefix(author).replace(/^[:\s\-|]+/, '').trim() || 'Unknown Author';
  title = title.replace(/^[:\s\-|]+/, '').trim() || 'Unknown Title';

  if (!torrentId) {
    const idFromUrl = torrentUrl.match(/\/t\/(\d+)/);
    if (idFromUrl) torrentId = idFromUrl[1];
  }
  if (!torrentId) return null;

  return {
    torrentId,
    title,
    author,
    series: series || 'Standalone',
    narrator: narrator !== 'N/A' ? narrator : mediaType === 'Audiobook' ? 'Unknown Narrator' : 'N/A',
    mediaType,
    format,
    sizeMB,
    sizeStr: sizeStr !== '0 MB' ? sizeStr : 'Unknown Size',
    freeleech,
    vip,
    bitrate,
    torrentUrl: torrentUrl || `https://www.myanonamouse.net/t/${torrentId}`,
    source,
    raw: cleanLine,
    year,
    category: categoryName,
  };
}
