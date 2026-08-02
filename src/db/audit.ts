import type { FastifyRequest } from 'fastify';
import { getAllSettings, getDb, setSettings } from './index.js';

const SECRET_KEYS = new Set([
  'mam_id',
  'qbit_password',
  'irc_nickserv_password',
  'discord_webhook_url',
  'discord_webhook_stream',
  'discord_webhook_errors',
  'discord_webhook_snatch',
]);

/** Keys that are operational noise — still auditable if changed, but omit from “public” snapshot. */
const EPHEMERAL_KEYS = new Set([
  'irc_status',
  'last_announce',
  'snatch_count_total',
  'mam_unsatisfied_active',
  'mam_unsatisfied_at',
  'mam_unsatisfied_disabled_filters',
  'mam_timed_lockout_until',
  'mam_timed_lockout_disabled_filters',
  'mam_timed_lockout_note',
]);

export type AuditActor = {
  userId: string | null;
  username: string;
  source: string;
};

export function actorFromRequest(req: FastifyRequest | null | undefined): AuditActor {
  const auth = req?.auth;
  if (!auth?.user) {
    return { userId: null, username: 'system', source: 'system' };
  }
  const source =
    auth.authType === 'api_key'
      ? `api_key:${(auth.apiKeyId || '').slice(0, 8) || 'unknown'}`
      : 'session';
  return {
    userId: auth.user.id,
    username: auth.user.username || 'unknown',
    source,
  };
}

export function redactSettingValue(key: string, value: string | undefined | null): string {
  const v = value ?? '';
  if (!SECRET_KEYS.has(key)) return v;
  if (!v) return '';
  if (key === 'mam_id' && v.length > 4) return `********${v.slice(-4)}`;
  return '[set]';
}

export function publicSettingsSnapshot(
  all?: Record<string, string>,
): Record<string, string | boolean> {
  const src = all || getAllSettings();
  const out: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(src)) {
    if (EPHEMERAL_KEYS.has(k)) continue;
    if (SECRET_KEYS.has(k)) {
      out[`${k}_set`] = Boolean(v);
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function writeAudit(input: {
  action: string;
  summary: string;
  detail?: unknown;
  actor?: AuditActor;
}): void {
  const actor = input.actor || { userId: null, username: 'system', source: 'system' };
  try {
    getDb()
      .prepare(
        `INSERT INTO audit_log (action, summary, detail, user_id, username, source)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.action,
        input.summary,
        JSON.stringify(input.detail ?? {}),
        actor.userId,
        actor.username,
        actor.source,
      );
    // Cap size
    getDb()
      .prepare(
        `DELETE FROM audit_log WHERE id NOT IN (
          SELECT id FROM audit_log ORDER BY id DESC LIMIT 1000
        )`,
      )
      .run();
  } catch (err) {
    console.error('[audit] write failed', err);
  }
}

export type AuditEntry = {
  id: number;
  action: string;
  summary: string;
  detail: unknown;
  userId: string | null;
  username: string;
  source: string;
  createdAt: string;
};

export function listAudit(limit = 100, action?: string): AuditEntry[] {
  const lim = Math.min(Math.max(limit, 1), 500);
  const rows = (
    action
      ? (getDb()
          .prepare(
            `SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT ?`,
          )
          .all(action, lim) as Array<Record<string, unknown>>)
      : (getDb()
          .prepare(`SELECT * FROM audit_log ORDER BY id DESC LIMIT ?`)
          .all(lim) as Array<Record<string, unknown>>)
  );
  return rows.map((r) => ({
    id: Number(r.id),
    action: String(r.action),
    summary: String(r.summary),
    detail: safeJson(String(r.detail || '{}')),
    userId: (r.user_id as string) || null,
    username: String(r.username || 'system'),
    source: String(r.source || 'system'),
    createdAt: String(r.created_at),
  }));
}

export type SettingsVersion = {
  id: number;
  version: number;
  summary: string;
  changedKeys: string[];
  diff: Record<string, { from: string; to: string }>;
  snapshot: Record<string, string | boolean>;
  userId: string | null;
  username: string;
  source: string;
  createdAt: string;
};

function nextVersionNumber(): number {
  const row = getDb()
    .prepare(`SELECT COALESCE(MAX(version), 0) AS v FROM settings_versions`)
    .get() as { v: number };
  return Number(row?.v || 0) + 1;
}

function pruneSettingsVersions(keep = 100): void {
  // Safer than DELETE … NOT IN (SELECT … LIMIT) which can misbehave on empty subqueries.
  const ids = getDb()
    .prepare(`SELECT id FROM settings_versions ORDER BY version DESC LIMIT -1 OFFSET ?`)
    .all(keep) as Array<{ id: number }>;
  if (!ids.length) return;
  const del = getDb().prepare(`DELETE FROM settings_versions WHERE id = ?`);
  const tx = getDb().transaction(() => {
    for (const r of ids) del.run(r.id);
  });
  tx();
}

function insertSettingsVersionRow(input: {
  version: number;
  summary: string;
  changedKeys: string[];
  diff: Record<string, { from: string; to: string }>;
  snapshot: Record<string, string | boolean>;
  actor: AuditActor;
  auditAction?: string;
}): SettingsVersion | null {
  try {
    const info = getDb()
      .prepare(
        `INSERT INTO settings_versions
          (version, summary, changed_keys, diff, snapshot, user_id, username, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.version,
        input.summary,
        JSON.stringify(input.changedKeys),
        JSON.stringify(input.diff),
        JSON.stringify(input.snapshot),
        input.actor.userId,
        input.actor.username,
        input.actor.source,
      );

    pruneSettingsVersions(100);

    writeAudit({
      action: input.auditAction || 'settings.update',
      summary: input.summary,
      detail: {
        version: input.version,
        changedKeys: input.changedKeys,
        diff: input.diff,
      },
      actor: input.actor,
    });

    return {
      id: Number(info.lastInsertRowid),
      version: input.version,
      summary: input.summary,
      changedKeys: input.changedKeys,
      diff: input.diff,
      snapshot: input.snapshot,
      userId: input.actor.userId,
      username: input.actor.username,
      source: input.actor.source,
      createdAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[audit] settings version failed', err);
    return null;
  }
}

/** If history is empty, capture current settings so the UI is never a dead end. */
export function ensureBaselineSettingsVersion(
  actor?: AuditActor,
): SettingsVersion | null {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM settings_versions`)
    .get() as { c: number };
  if (Number(row?.c || 0) > 0) return null;

  const all = getAllSettings();
  return insertSettingsVersionRow({
    version: 1,
    summary: 'Baseline snapshot (current settings)',
    changedKeys: [],
    diff: {},
    snapshot: publicSettingsSnapshot(all),
    actor: actor || { userId: null, username: 'system', source: 'system' },
    auditAction: 'settings.baseline',
  });
}

/**
 * Record a settings version when keys actually change.
 * `before` / `after` should be full settings maps (secrets OK; redacted on write).
 */
export function recordSettingsVersion(input: {
  before: Record<string, string>;
  after: Record<string, string>;
  updates: Record<string, string>;
  actor?: AuditActor;
  summary?: string;
  auditAction?: string;
}): SettingsVersion | null {
  ensureBaselineSettingsVersion(input.actor);

  const changedKeys = Object.keys(input.updates).filter((k) => {
    const a = String(input.before[k] ?? '');
    const b = String(input.after[k] ?? input.updates[k] ?? '');
    return a !== b;
  });
  if (changedKeys.length === 0) return null;

  const diff: Record<string, { from: string; to: string }> = {};
  for (const k of changedKeys) {
    diff[k] = {
      from: redactSettingValue(k, input.before[k]),
      to: redactSettingValue(k, input.after[k] ?? input.updates[k]),
    };
  }

  const actor = input.actor || { userId: null, username: 'system', source: 'system' };
  const summary =
    input.summary ||
    (changedKeys.length <= 4
      ? `Updated ${changedKeys.join(', ')}`
      : `Updated ${changedKeys.length} keys (${changedKeys.slice(0, 3).join(', ')}…)`);

  return insertSettingsVersionRow({
    version: nextVersionNumber(),
    summary,
    changedKeys,
    diff,
    snapshot: publicSettingsSnapshot(input.after),
    actor,
    auditAction: input.auditAction || 'settings.update',
  });
}

/** Convert a stored public snapshot into setSettings() updates (skips secrets). */
export function snapshotToRestorableUpdates(
  snapshot: Record<string, string | boolean>,
): Record<string, string> {
  const updates: Record<string, string> = {};
  for (const [k, v] of Object.entries(snapshot || {})) {
    if (k.endsWith('_set')) continue;
    if (SECRET_KEYS.has(k) || EPHEMERAL_KEYS.has(k)) continue;
    if (typeof v === 'boolean') continue;
    updates[k] = String(v);
  }
  return updates;
}

export function restoreSettingsVersion(
  version: number,
  actor?: AuditActor,
): { ok: true; version: SettingsVersion; restoredKeys: string[] } | { ok: false; error: string } {
  const target = getSettingsVersion(version);
  if (!target) return { ok: false, error: `Version v${version} not found` };

  const updates = snapshotToRestorableUpdates(target.snapshot);
  if (Object.keys(updates).length === 0) {
    return { ok: false, error: 'No restorable fields in that snapshot (secrets cannot be restored)' };
  }

  const before = getAllSettings();
  setSettings(updates);
  const after = getAllSettings();

  const ver = recordSettingsVersion({
    before,
    after,
    updates,
    actor,
    summary: `Restored non-secret settings from v${version}`,
    auditAction: 'settings.restore',
  });

  if (!ver) {
    // Nothing differed from current — still report success
    return {
      ok: true,
      version: target,
      restoredKeys: [],
    };
  }

  return {
    ok: true,
    version: ver,
    restoredKeys: ver.changedKeys,
  };
}

export function listSettingsVersions(limit = 50): SettingsVersion[] {
  ensureBaselineSettingsVersion();
  const lim = Math.min(Math.max(limit, 1), 200);
  const rows = getDb()
    .prepare(`SELECT * FROM settings_versions ORDER BY version DESC LIMIT ?`)
    .all(lim) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    version: Number(r.version),
    summary: String(r.summary),
    changedKeys: safeJson(String(r.changed_keys || '[]')) as string[],
    diff: safeJson(String(r.diff || '{}')) as Record<string, { from: string; to: string }>,
    snapshot: safeJson(String(r.snapshot || '{}')) as Record<string, string | boolean>,
    userId: (r.user_id as string) || null,
    username: String(r.username || 'system'),
    source: String(r.source || 'system'),
    createdAt: String(r.created_at),
  }));
}

export function getSettingsVersion(version: number): SettingsVersion | null {
  const r = getDb()
    .prepare(`SELECT * FROM settings_versions WHERE version = ?`)
    .get(version) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: Number(r.id),
    version: Number(r.version),
    summary: String(r.summary),
    changedKeys: safeJson(String(r.changed_keys || '[]')) as string[],
    diff: safeJson(String(r.diff || '{}')) as Record<string, { from: string; to: string }>,
    snapshot: safeJson(String(r.snapshot || '{}')) as Record<string, string | boolean>,
    userId: (r.user_id as string) || null,
    username: String(r.username || 'system'),
    source: String(r.source || 'system'),
    createdAt: String(r.created_at),
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
