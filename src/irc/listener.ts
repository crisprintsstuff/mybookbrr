import tls from 'node:tls';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { getSetting, setSetting } from '../db/index.js';
import { parseAnnouncementLine } from './announceParser.js';
import type { Release } from '../types.js';

export interface IrcStatus {
  connected: boolean;
  identified: boolean;
  joined: boolean;
  host: string;
  port: number;
  nick: string;
  channel: string;
  lastError: string | null;
  lastLineAt: string | null;
  phase: string;
  recentLines: string[];
}

type Socket = tls.TLSSocket | net.Socket;

function sanitizeIrcLine(line: string): string {
  return line
    .replace(/(PRIVMSG\s+NickServ\s+:identify\s+)\S+/i, '$1*******')
    .replace(/(NICKSERV\s+IDENTIFY\s+)\S+/i, '$1*******')
    .replace(/(PRIVMSG\s+NickServ\s+:GHOST\s+\S+\s+)\S+/i, '$1*******')
    .replace(/(identify\s+)\S+/i, '$1*******');
}

export class IrcListener extends EventEmitter {
  private socket: Socket | null = null;
  private buffer = '';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private joinTimer: NodeJS.Timeout | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private shouldRun = false;
  private identified = false;
  private joined = false;
  private sentIdentify = false;
  private recentLines: string[] = [];
  private phase = 'disconnected';
  private status: IrcStatus = {
    connected: false,
    identified: false,
    joined: false,
    host: 'irc.myanonamouse.net',
    port: 6697,
    nick: 'MyBookBRR',
    channel: '#announce',
    lastError: null,
    lastLineAt: null,
    phase: 'disconnected',
    recentLines: [],
  };

  getStatus(): IrcStatus {
    return {
      ...this.status,
      identified: this.identified,
      joined: this.joined,
      phase: this.phase,
      recentLines: [...this.recentLines],
    };
  }

  /** True while Start IRC has been requested (connected or reconnecting). */
  isActive(): boolean {
    return this.shouldRun;
  }

  start(): void {
    this.shouldRun = true;
    // Already online — do not bounce (avoids NickServ/JOIN flood).
    if (this.socket && !this.socket.destroyed && this.status.connected) {
      this.note('[SYSTEM] start() ignored — already connected');
      return;
    }
    this.connect();
  }

  stop(): void {
    this.shouldRun = false;
    this.clearTimers();
    if (this.socket && !this.socket.destroyed) {
      try {
        this.socket.write('QUIT :MyBookBRR stopping\r\n');
      } catch {
        /* ignore */
      }
      this.socket.destroy();
    }
    this.socket = null;
    this.resetAuthState();
    this.setPhase('disconnected');
    setSetting('irc_status', 'disconnected');
  }

  /** Graceful reconnect with delay — only when connection settings actually changed. */
  restart(reason = 'restart'): void {
    this.note(`[SYSTEM] IRC restart scheduled (${reason})`);
    this.shouldRun = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    const wasConnected = Boolean(this.socket && !this.socket.destroyed);
    if (wasConnected) {
      try {
        this.socket?.write('QUIT :reconnecting\r\n');
      } catch {
        /* ignore */
      }
      this.socket?.destroy();
      this.socket = null;
      this.resetAuthState();
      this.setPhase('disconnected');
    }
    this.clearTimers();
    // Delay reconnect so MAM doesn't see rapid reconnect floods.
    const delayMs = wasConnected ? 5000 : 0;
    this.setPhase(delayMs ? 'restarting' : 'connecting');
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.shouldRun) return;
      this.connect();
    }, delayMs);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.joinTimer) clearTimeout(this.joinTimer);
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.joinTimer = null;
    this.restartTimer = null;
  }

  private resetAuthState(): void {
    this.identified = false;
    this.joined = false;
    this.sentIdentify = false;
    this.status.connected = false;
    this.status.identified = false;
    this.status.joined = false;
  }

  private setPhase(phase: string): void {
    this.phase = phase;
    this.status.phase = phase;
    this.emit('status', this.getStatus());
  }

  private note(line: string): void {
    const safe = sanitizeIrcLine(line);
    this.recentLines.push(safe);
    if (this.recentLines.length > 40) this.recentLines.shift();
    console.log(`[IRC] ${safe}`);
  }

  private send(line: string, silent = false): void {
    if (!this.socket || this.socket.destroyed) return;
    this.socket.write(`${line}\r\n`);
    if (!silent) this.note(`>>> ${line}`);
  }

  private scheduleReconnect(): void {
    if (!this.shouldRun) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), 8000);
  }

  private nickservPassword(): string {
    return (getSetting('irc_nickserv_password') || '').trim();
  }

  private identifyOnce(): void {
    const password = this.nickservPassword();
    if (!password || this.sentIdentify || this.identified) return;
    this.sentIdentify = true;
    this.setPhase('identifying');
    // MAM/Atheme style — lowercase identify matches BookBRR / common clients
    this.send(`PRIVMSG NickServ :identify ${password}`);
    this.note('[SYSTEM] NickServ IDENTIFY sent (password redacted)');
  }

  private joinChannel(): void {
    if (this.joined) return;
    const channel = getSetting('irc_channel') || '#announce';
    this.setPhase('joining');
    this.send(`JOIN ${channel}`);
  }

  private scheduleJoin(delayMs: number, reason: string): void {
    if (this.joinTimer) clearTimeout(this.joinTimer);
    this.note(`[SYSTEM] JOIN scheduled in ${delayMs}ms (${reason})`);
    this.joinTimer = setTimeout(() => this.joinChannel(), delayMs);
  }

  private markIdentified(reason: string): void {
    if (this.identified) {
      if (!this.joined) this.scheduleJoin(300, reason);
      return;
    }
    this.identified = true;
    this.status.identified = true;
    setSetting('irc_status', 'identified');
    this.note(`[SYSTEM] NickServ OK — ${reason}`);
    this.setPhase('identified');
    this.scheduleJoin(400, 'nickserv confirmed');
  }

  private connect(): void {
    if (!this.shouldRun) return;
    this.clearTimers();
    if (this.socket) {
      try {
        this.socket.removeAllListeners();
        this.socket.destroy();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }

    const host = getSetting('irc_host') || 'irc.myanonamouse.net';
    const port = Number(getSetting('irc_port') || 6697);
    // MAM IRC nicks commonly use "account|client" (pipe is intentional).
    const nick =
      (getSetting('irc_nick') || 'MyBookBRR')
        .replace(/[^a-zA-Z0-9_\-\[\]\{\}\|]/g, '')
        .slice(0, 30) || 'MyBookBRR';
    const channel = getSetting('irc_channel') || '#announce';
    const useTls = port === 6697 || port === 7000 || getSetting('irc_tls') === 'true';
    const hasPass = Boolean(this.nickservPassword());

    this.resetAuthState();
    this.status = {
      ...this.status,
      host,
      port,
      nick,
      channel,
      connected: false,
      identified: false,
      joined: false,
      lastError: null,
      recentLines: this.recentLines,
      phase: 'connecting',
    };
    this.setPhase('connecting');
    setSetting('irc_status', 'connecting');
    this.note(`[SYSTEM] Connecting ${host}:${port} as ${nick} (nickserv=${hasPass ? 'yes' : 'no'})`);

    const onConnect = () => {
      this.status.connected = true;
      this.status.lastError = null;
      setSetting('irc_status', 'connected');
      this.setPhase('connected');
      // USER must be a simple ident; NICK keeps the full MAM "account|client" form.
      const userIdent = (nick.split('|')[0] || nick).replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 10) || 'mybookbrr';
      this.send(`NICK ${nick}`);
      this.send(`USER ${userIdent} 0 * :MyBookBRR`);
      this.pingTimer = setInterval(() => {
        this.send(`PING :mybookbrr_${Date.now()}`, true);
      }, 60000);
    };

    const onData = (chunk: Buffer | string) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split(/\r?\n/);
      this.buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) this.handleLine(trimmed);
      }
    };

    const onClose = () => {
      this.status.connected = false;
      this.status.identified = false;
      this.status.joined = false;
      this.identified = false;
      this.joined = false;
      this.sentIdentify = false;
      setSetting('irc_status', 'disconnected');
      this.clearTimers();
      this.note('[SYSTEM] Connection closed');
      this.setPhase('disconnected');
      this.scheduleReconnect();
    };

    const onError = (err: Error) => {
      this.status.lastError = err.message;
      setSetting('irc_status', `error: ${err.message}`);
      this.note(`[SYSTEM] Socket error: ${err.message}`);
      this.setPhase('error');
      this.emit('error', err);
    };

    try {
      if (useTls) {
        this.socket = tls.connect({ host, port, servername: host, rejectUnauthorized: true }, onConnect);
      } else {
        this.socket = net.connect({ host, port }, onConnect);
      }
      this.socket.setEncoding('utf8');
      this.socket.on('data', onData);
      this.socket.on('close', onClose);
      this.socket.on('error', onError);
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)));
      this.scheduleReconnect();
    }
  }

  private handleLine(line: string): void {
    this.status.lastLineAt = new Date().toISOString();

    // Always log inbound (redacted) except noisy PINGs
    if (!line.startsWith('PING ')) {
      this.note(`<<< ${line}`);
    }

    if (line.startsWith('PING ')) {
      this.send(`PONG ${line.slice(5)}`, true);
      return;
    }

    const passkey = this.nickservPassword();
    const lower = line.toLowerCase();

    // Welcome (001) — identify once, then join after confirm or timeout
    if (line.includes(' 001 ')) {
      if (passkey) {
        this.identifyOnce();
        this.scheduleJoin(2000, 'post-identify fallback timeout');
      } else {
        this.scheduleJoin(600, 'no nickserv password');
      }
      return;
    }

    // End of MOTD — only act if we somehow missed 001
    if ((line.includes(' 376 ') || line.includes(' 422 ')) && !this.sentIdentify && !this.joined) {
      if (passkey) {
        this.identifyOnce();
        this.scheduleJoin(2000, 'motd fallback');
      } else {
        this.scheduleJoin(400, 'motd no-auth');
      }
      return;
    }

    // NickServ prompt ("type /msg NickServ IDENTIFY ...")
    if (lower.includes('nickserv') && lower.includes('identify') && (lower.includes('type') || lower.includes('this nickname is registered'))) {
      this.identifyOnce();
      return;
    }

    // NickServ / SASL success
    const nickservOk =
      lower.includes('password accepted') ||
      lower.includes('you are now identified') ||
      lower.includes('successfully identified') ||
      lower.includes('recognized') ||
      line.includes(' 900 ') ||
      line.includes(' 903 ') ||
      line.includes(' 307 ');
    if (nickservOk) {
      this.markIdentified(line.includes(' 90') ? `numeric ${line.match(/\s(90\d)\s/)?.[1] || '9xx'}` : 'nickserv notice');
      return;
    }

    // Auth failure
    if (
      lower.includes('nickserv') &&
      (lower.includes('invalid password') ||
        lower.includes('incorrect password') ||
        lower.includes('access denied') ||
        lower.includes('authentication failed'))
    ) {
      this.status.lastError = 'NickServ: invalid password';
      setSetting('irc_status', 'error: NickServ invalid password');
      this.note('[SYSTEM] NickServ rejected password');
      if (this.joinTimer) {
        clearTimeout(this.joinTimer);
        this.joinTimer = null;
      }
      this.setPhase('auth_failed');
      return;
    }

    // Nick in use
    if (line.includes(' 433 ')) {
      const desired = this.status.nick || 'MyBookBRR';
      if (passkey) {
        this.note(`[SYSTEM] Nick in use — GHOST ${desired}`);
        this.send(`PRIVMSG NickServ :GHOST ${desired} ${passkey}`);
        setTimeout(() => {
          this.send(`NICK ${desired}`);
          this.status.nick = desired;
          this.sentIdentify = false;
          this.identifyOnce();
        }, 800);
      } else {
        const alt = `${desired.slice(0, 12)}_${Math.floor(Math.random() * 100)}`;
        this.send(`NICK ${alt}`);
        this.status.nick = alt;
      }
      return;
    }

    // Channel requires registration
    if (line.includes(' 477 ')) {
      this.status.lastError = 'Channel requires NickServ (477)';
      this.note('[SYSTEM] 477 — must be identified; re-IDENTIFY then JOIN');
      this.joined = false;
      this.status.joined = false;
      this.sentIdentify = false;
      this.identifyOnce();
      this.scheduleJoin(1200, 'retry after 477');
      return;
    }

    // JOIN success — either our JOIN echo or names list end
    const channel = (getSetting('irc_channel') || '#announce').toLowerCase();
    if (
      (!this.joined && /JOIN\s+:?#announce/i.test(line)) ||
      (line.includes(' 366 ') && lower.includes(channel.replace(/^#/, '')))
    ) {
      this.joined = true;
      this.status.joined = true;
      setSetting('irc_status', this.identified ? 'joined (identified)' : 'joined');
      this.note('[SYSTEM] Successfully joined channel');
      this.setPhase('joined');
      return;
    }

    // Cannot join
    if (/\s(471|473|474|475)\s/.test(line)) {
      this.status.lastError = `JOIN failed: ${line}`;
      this.note(`[SYSTEM] JOIN failed — ${line}`);
      this.setPhase('join_failed');
      return;
    }

    if (!/PRIVMSG/i.test(line)) return;
    if (/PRIVMSG\s+NickServ/i.test(line)) return;

    const release = parseAnnouncementLine(line, 'irc');
    if (!release) return;

    setSetting(
      'last_announce',
      JSON.stringify({
        torrentId: release.torrentId,
        title: release.title,
        author: release.author,
        at: new Date().toISOString(),
      })
    );
    this.emit('announce', release as Release);
  }
}

export const ircListener = new IrcListener();
