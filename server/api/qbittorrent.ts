import axios, { type AxiosInstance } from 'axios';

/** What qBittorrent reports for one torrent (the fields we use). */
export interface QbitTorrent {
  hash: string;
  /** 0 to 1. */
  progress: number;
  /** Bytes selected for download. */
  size: number;
  amount_left: number;
  /** Seconds; 8640000 means unknown. */
  eta: number;
  state: string;
  dlspeed: number;
}

/** qBittorrent's "no estimate" ETA. */
export const QBIT_NO_ETA = 8640000;

/**
 * Minimal qBittorrent Web API client: logs in (unless qBittorrent bypasses
 * auth for this address) and reads torrents by hash.
 */
class QbittorrentAPI {
  private axios: AxiosInstance;
  private username: string;
  private password: string;
  private cookie?: string;

  constructor({
    url,
    username = '',
    password = '',
  }: {
    url: string;
    username?: string;
    password?: string;
  }) {
    const baseURL = url.replace(/\/+$/, '');
    this.username = username;
    this.password = password;
    this.axios = axios.create({
      baseURL,
      timeout: 10000,
      // qBittorrent's CSRF protection wants a Referer/Origin matching itself.
      headers: { Referer: baseURL, Origin: baseURL },
    });
  }

  private async login(): Promise<void> {
    const response = await this.axios.post(
      '/api/v2/auth/login',
      new URLSearchParams({
        username: this.username,
        password: this.password,
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true,
      }
    );

    if (
      response.status >= 400 ||
      (typeof response.data === 'string' && response.data.trim() === 'Fails.')
    ) {
      throw new Error(
        response.status === 403
          ? '[qBittorrent] Too many failed logins; this address is banned for a while'
          : '[qBittorrent] Login failed. Check the username and password.'
      );
    }

    // SID on older versions, QBT_SID_<port> on newer ones.
    const cookies = response.headers['set-cookie'] ?? [];
    const sid = cookies
      .map((cookie) => cookie.split(';')[0])
      .find((cookie) => /SID/i.test(cookie.split('=')[0]));

    this.cookie = sid;
  }

  private async request<T>(path: string, params?: Record<string, string>) {
    const send = () =>
      this.axios.get<T>(path, {
        params,
        headers: this.cookie ? { Cookie: this.cookie } : undefined,
        validateStatus: () => true,
      });

    let response = await send();

    // Not logged in yet, or the session expired.
    if (response.status === 403 || response.status === 401) {
      await this.login();
      response = await send();
    }

    if (response.status >= 400) {
      throw new Error(`[qBittorrent] ${path} returned ${response.status}`);
    }

    return response.data;
  }

  /** Connects (logging in if needed) and returns qBittorrent's version. */
  public async testConnection(): Promise<string> {
    return this.request<string>('/api/v2/app/version');
  }

  /** The torrents with these hashes (any case); missing ones are left out. */
  public async getTorrents(hashes: string[]): Promise<QbitTorrent[]> {
    if (hashes.length === 0) {
      return [];
    }

    const data = await this.request<QbitTorrent[]>('/api/v2/torrents/info', {
      hashes: hashes.map((hash) => hash.toLowerCase()).join('|'),
    });

    return Array.isArray(data) ? data : [];
  }
}

export default QbittorrentAPI;
