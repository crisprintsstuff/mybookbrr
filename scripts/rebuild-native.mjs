#!/usr/bin/env node
/**
 * Rebuild better-sqlite3 for the current Node ABI.
 * On Debian/Ubuntu Node packages, prebuilds target ABI 108 while the
 * runtime is ABI 109 — compile against system headers at /usr.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const env = { ...process.env };
if (fs.existsSync('/usr/include/node/node.h')) {
  env.npm_config_nodedir = '/usr';
  console.log('[rebuild:native] Using system Node headers (/usr) for ABI', process.versions.modules);
} else {
  console.log('[rebuild:native] Rebuilding for NODE_MODULE_VERSION', process.versions.modules);
}

const result = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['rebuild', 'better-sqlite3', '--build-from-source'],
  { stdio: 'inherit', env }
);

process.exit(result.status ?? 1);
