/**
 * One-shot IRC auth probe using saved settings.
 * Does not print the NickServ password.
 */
import tls from 'node:tls';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../data/mybookbrr.db');
const db = new Database(dbPath, { readonly: true });
const get = (k) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
  return row?.value || '';
};

const host = get('irc_host') || 'irc.myanonamouse.net';
const port = Number(get('irc_port') || 6697);
const rawNick = get('irc_nick') || 'MyBookBRR';
const nick = rawNick.split('|')[0].replace(/[^a-zA-Z0-9_\-\[\]\{\}]/g, '').slice(0, 30) || 'MyBookBRR';
const password = get('irc_nickserv_password').trim();
const channel = get('irc_channel') || '#announce';

if (!password) {
  console.error('FAIL: no irc_nickserv_password in settings');
  process.exit(2);
}

console.log(`Probe ${host}:${port} nick=${nick} (from "${rawNick}") channel=${channel}`);

let identified = false;
let joined = false;
let authFailed = false;
let buffer = '';
const lines = [];

const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: true }, () => {
  socket.write(`NICK ${nick}\r\n`);
  socket.write(`USER ${nick.slice(0, 10)} 0 * :MyBookBRRProbe\r\n`);
});

function redact(s) {
  return s.replace(/(identify\s+)\S+/gi, '$1*******').replace(/(GHOST\s+\S+\s+)\S+/gi, '$1*******');
}

socket.setEncoding('utf8');
socket.on('data', (chunk) => {
  buffer += chunk;
  const parts = buffer.split(/\r?\n/);
  buffer = parts.pop() || '';
  for (const line of parts) {
    const t = line.trim();
    if (!t) continue;
    if (!t.startsWith('PING ')) lines.push(redact(t));
    if (t.startsWith('PING ')) {
      socket.write(`PONG ${t.slice(5)}\r\n`);
      continue;
    }
    const lower = t.toLowerCase();
    if (t.includes(' 001 ')) {
      socket.write(`PRIVMSG NickServ :identify ${password}\r\n`);
      lines.push('>>> PRIVMSG NickServ :identify *******');
      setTimeout(() => {
        if (!joined) socket.write(`JOIN ${channel}\r\n`);
      }, 2000);
    }
    if (
      lower.includes('password accepted') ||
      lower.includes('you are now identified') ||
      lower.includes('successfully identified') ||
      lower.includes('recognized') ||
      t.includes(' 900 ') ||
      t.includes(' 903 ')
    ) {
      identified = true;
      socket.write(`JOIN ${channel}\r\n`);
    }
    if (lower.includes('invalid password') || lower.includes('incorrect password')) {
      authFailed = true;
    }
    if (t.includes(' 477 ')) {
      lines.push('GOT 477 — channel requires identify');
    }
    if (/JOIN\s+:?#announce/i.test(t) || (t.includes(' 366 ') && lower.includes('announce'))) {
      joined = true;
    }
  }
});

socket.on('error', (err) => {
  console.error('SOCKET ERROR', err.message);
  process.exit(1);
});

setTimeout(() => {
  socket.end();
  console.log('--- recent lines ---');
  for (const l of lines.slice(-35)) console.log(l);
  console.log('--- result ---');
  console.log({ identified, joined, authFailed, lineCount: lines.length });
  if (authFailed) {
    console.log('FAIL: NickServ rejected password');
    process.exit(3);
  }
  if (identified && joined) {
    console.log('OK: NickServ authenticated and joined #announce');
    process.exit(0);
  }
  if (joined && !identified) {
    console.log('WARN: joined channel but no NickServ confirmation seen');
    process.exit(4);
  }
  if (identified && !joined) {
    console.log('WARN: identified but did not join #announce');
    process.exit(5);
  }
  console.log('FAIL: did not identify or join');
  process.exit(6);
}, 8000);
