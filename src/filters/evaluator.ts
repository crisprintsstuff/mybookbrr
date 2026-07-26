import type { FilterEvaluation, FilterRule, Release } from '../types.js';

function windowMs(period: FilterRule['limitPeriod']): number {
  switch (period) {
    case 'daily':
      return 24 * 60 * 60 * 1000;
    case 'weekly':
      return 7 * 24 * 60 * 60 * 1000;
    case 'monthly':
      return 30 * 24 * 60 * 60 * 1000;
    default:
      return 0;
  }
}

function formatsAllowAll(formats: string[] | undefined): boolean {
  if (!formats?.length) return true;
  return formats.some((f) => f.toUpperCase() === 'ALL');
}

function formatAllowed(formats: string[] | undefined, releaseFormat: string): boolean {
  if (formatsAllowAll(formats)) return true;
  const want = releaseFormat.toUpperCase();
  return (formats || []).some((f) => f.toUpperCase() === want);
}

export function evaluateRelease(release: Release, filters: FilterRule[]): FilterEvaluation {
  if (!release || !filters.length) {
    return {
      matched: false,
      matchedFilter: null,
      reasons: ['No active filter rules configured or invalid release.'],
      evaluationLog: [],
    };
  }

  const active = filters.filter((f) => f.enabled).sort((a, b) => (b.priority || 0) - (a.priority || 0));
  const evaluationLog: FilterEvaluation['evaluationLog'] = [];

  for (const filter of active) {
    const failures: string[] = [];
    const limitPeriod = filter.limitPeriod || 'unlimited';
    const maxDownloads = Number(filter.maxDownloads || 0);

    if (limitPeriod !== 'unlimited' && maxDownloads > 0) {
      const ms = windowMs(limitPeriod);
      const now = Date.now();
      const recent = (filter.snatchHistoryTimestamps || []).filter((ts) => now - ts < ms);
      if (recent.length >= maxDownloads) {
        failures.push(
          `Download limit reached (${recent.length}/${maxDownloads} in ${limitPeriod} window)`
        );
      }
    }

    // Constraint checks apply to normal rules and catch-all (formats / media / FL / size).
    if (filter.mediaTypes?.length && !filter.mediaTypes.includes('All')) {
      if (!filter.mediaTypes.includes(release.mediaType)) {
        failures.push(
          `Media type mismatch (release: ${release.mediaType}, filter: ${filter.mediaTypes.join(', ')})`
        );
      }
    }

    if (!formatAllowed(filter.formats, release.format)) {
      failures.push(
        `Format mismatch (release: ${release.format}, allowed: ${(filter.formats || []).join(', ')})`
      );
    }

    if (filter.freeleechOnly && !release.freeleech) {
      failures.push('Freeleech required');
    }
    if (filter.vipOnly && !release.vip) {
      failures.push('VIP required');
    }
    if (filter.minSizeMB > 0 && release.sizeMB < filter.minSizeMB) {
      failures.push(`Size ${release.sizeMB} MB below min ${filter.minSizeMB} MB`);
    }
    if (filter.maxSizeMB > 0 && release.sizeMB > filter.maxSizeMB) {
      failures.push(`Size ${release.sizeMB} MB above max ${filter.maxSizeMB} MB`);
    }
    if (release.mediaType === 'Audiobook' && filter.minBitrate > 0 && release.bitrate > 0) {
      if (release.bitrate < filter.minBitrate) {
        failures.push(`Bitrate ${release.bitrate} kbps below min ${filter.minBitrate}`);
      }
    }

    if (filter.matchAllReleases) {
      if (failures.length === 0) {
        return {
          matched: true,
          matchedFilter: filter,
          reasons: [`PASSED: Catch-all filter '${filter.name}'`],
          evaluationLog,
        };
      }
      evaluationLog.push({ filterName: filter.name, failures });
      continue;
    }

    if (filter.authors?.length) {
      const ok = filter.authors.some(
        (a) =>
          release.author.toLowerCase().includes(a.toLowerCase()) ||
          a.toLowerCase().includes(release.author.toLowerCase())
      );
      if (!ok) failures.push(`Author '${release.author}' not in list`);
    }

    if (filter.excludeAuthors?.length) {
      const excluded = filter.excludeAuthors.some(
        (ea) =>
          release.author.toLowerCase().includes(ea.toLowerCase()) ||
          release.title.toLowerCase().includes(ea.toLowerCase())
      );
      if (excluded) failures.push('Excluded author/keyword matched');
    }

    if (filter.narrators?.length) {
      const ok = filter.narrators.some((n) =>
        release.narrator.toLowerCase().includes(n.toLowerCase())
      );
      if (!ok) failures.push(`Narrator '${release.narrator}' not in list`);
    }

    if (filter.series?.length) {
      const ok = filter.series.some(
        (s) =>
          release.series.toLowerCase().includes(s.toLowerCase()) ||
          release.title.toLowerCase().includes(s.toLowerCase())
      );
      if (!ok) failures.push(`Series '${release.series}' not in list`);
    }

    if (filter.titlePattern?.trim()) {
      try {
        const re = new RegExp(filter.titlePattern, 'i');
        const hay = `${release.author} ${release.title} ${release.series}`;
        if (!re.test(hay)) failures.push(`Title regex '${filter.titlePattern}' did not match`);
      } catch (err) {
        failures.push(`Invalid title regex: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (failures.length === 0) {
      return {
        matched: true,
        matchedFilter: filter,
        reasons: [`PASSED: Filter '${filter.name}' (priority ${filter.priority})`],
        evaluationLog,
      };
    }
    evaluationLog.push({ filterName: filter.name, failures });
  }

  return {
    matched: false,
    matchedFilter: null,
    reasons: ['No filter matched this release.'],
    evaluationLog,
  };
}
