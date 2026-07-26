import { getSetting, setSettings } from '../db/index.js';
import { disableAllEnabledFilters, enableFiltersByIds, listFilters } from '../db/repos.js';
import { notifySystemError } from '../notify/discord.js';

export interface UnsatisfiedStatus {
  active: boolean;
  at: string | null;
  disabledFilterIds: string[];
  autoDisableEnabled: boolean;
  message: string | null;
}

function parseIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function getUnsatisfiedStatus(): UnsatisfiedStatus {
  const active = getSetting('mam_unsatisfied_active') === 'true';
  return {
    active,
    at: getSetting('mam_unsatisfied_at') || null,
    disabledFilterIds: parseIds(getSetting('mam_unsatisfied_disabled_filters')),
    autoDisableEnabled: getSetting('filters_auto_disable_on_unsatisfied') !== 'false',
    message: active
      ? 'MAM unsatisfied torrent limit active — enabled filters were turned off to avoid repeated download failures.'
      : null,
  };
}

/**
 * Called when MAM returns an unsatisfied-limit error.
 * Disables all enabled filters (if auto-disable is on) and records lockout state.
 */
export async function handleUnsatisfiedLimit(context?: {
  torrentId?: string;
  title?: string;
}): Promise<{ disabledIds: string[]; alreadyActive: boolean; detail: string; autoDisable: boolean }> {
  const alreadyActive = getSetting('mam_unsatisfied_active') === 'true';
  const autoDisable = getSetting('filters_auto_disable_on_unsatisfied') !== 'false';

  let disabledIds = parseIds(getSetting('mam_unsatisfied_disabled_filters'));
  if (autoDisable) {
    const newlyDisabled = disableAllEnabledFilters();
    disabledIds = Array.from(new Set([...disabledIds, ...newlyDisabled]));
  }

  setSettings({
    mam_unsatisfied_active: 'true',
    mam_unsatisfied_at: new Date().toISOString(),
    mam_unsatisfied_disabled_filters: JSON.stringify(disabledIds),
  });

  const detail = autoDisable
    ? `Disabled ${disabledIds.length} filter(s). Seed existing torrents on MAM, then clear the lockout and re-enable filters.`
    : 'Auto-disable is off — filters left as-is. Seed existing torrents on MAM to clear the limit.';

  if (!alreadyActive) {
    await notifySystemError(
      'MAM unsatisfied torrent limit',
      `${detail}${context?.title ? ` Last attempt: ${context.title}` : ''}`,
      'Filter guard'
    );
  }

  console.warn(`[Filters] Unsatisfied limit detected — ${detail}`);
  return { disabledIds, alreadyActive, detail, autoDisable };
}

export function clearUnsatisfiedLockout(reenableFilters: boolean): {
  cleared: boolean;
  reenabled: number;
  enabledCount: number;
} {
  const ids = parseIds(getSetting('mam_unsatisfied_disabled_filters'));
  let reenabled = 0;
  if (reenableFilters && ids.length) {
    reenabled = enableFiltersByIds(ids);
  }
  setSettings({
    mam_unsatisfied_active: 'false',
    mam_unsatisfied_at: '',
    mam_unsatisfied_disabled_filters: '[]',
  });
  return {
    cleared: true,
    reenabled,
    enabledCount: listFilters().filter((f) => f.enabled).length,
  };
}
