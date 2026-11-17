import QbittorrentAPI, {
  QBIT_NO_ETA,
  type QbitTorrent,
} from '@server/api/qbittorrent';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

/**
 * Live download progress straight from qBittorrent. Radarr, Sonarr and Lidarr
 * only re-read their download client about once a minute, so their queues lag;
 * they still tell us which torrent belongs to which request (the queue's
 * downloadId is the torrent hash), and qBittorrent says how far along it is.
 */

export interface LiveProgress {
  size: number;
  sizeLeft: number;
  /** Undefined when qBittorrent has no estimate (stalled, queued, paused). */
  estimatedCompletionTime?: Date;
  /** In the *arr queue's vocabulary, so the UI needs no changes. */
  status: string;
}

const COMPLETE_STATES = new Set([
  'uploading',
  'stalledUP',
  'queuedUP',
  'pausedUP',
  'stoppedUP',
  'forcedUP',
  'checkingUP',
]);

const toStatus = (torrent: QbitTorrent): string => {
  if (torrent.progress >= 1 || COMPLETE_STATES.has(torrent.state)) {
    return 'completed';
  }

  switch (torrent.state) {
    case 'queuedDL':
      return 'queued';
    case 'pausedDL':
    case 'stoppedDL':
      return 'paused';
    case 'error':
    case 'missingFiles':
      return 'warning';
    default:
      return 'downloading';
  }
};

export const toLiveProgress = (
  torrent: QbitTorrent,
  now = Date.now()
): LiveProgress => {
  const status = toStatus(torrent);
  const hasEta =
    status === 'downloading' &&
    torrent.eta > 0 &&
    torrent.eta < QBIT_NO_ETA &&
    torrent.dlspeed > 0;

  return {
    size: torrent.size,
    sizeLeft: status === 'completed' ? 0 : torrent.amount_left,
    estimatedCompletionTime: hasEta
      ? new Date(now + torrent.eta * 1000)
      : undefined,
    status,
  };
};

let client: { key: string; api: QbittorrentAPI } | undefined;

/** The configured client, rebuilt when the settings change. */
const getClient = (): QbittorrentAPI | undefined => {
  const { url, username, password } = getSettings().qbittorrent ?? {};

  if (!url) {
    client = undefined;
    return undefined;
  }

  const key = JSON.stringify([url, username, password]);

  if (client?.key !== key) {
    client = { key, api: new QbittorrentAPI({ url, username, password }) };
  }

  return client.api;
};

export const isLiveTrackingEnabled = (): boolean =>
  !!getSettings().qbittorrent?.url;

/** Same hashes within a few seconds share one qBittorrent call. */
const CACHE_MS = 5 * 1000;
let recent:
  | { key: string; at: number; result: Promise<Map<string, LiveProgress>> }
  | undefined;

/** Progress for the torrents with these hashes, keyed by lowercase hash. */
export const fetchLiveProgress = async (
  hashes: (string | undefined)[]
): Promise<Map<string, LiveProgress>> => {
  const api = getClient();
  const wanted = [
    ...new Set(
      hashes
        .filter((hash): hash is string => !!hash)
        .map((h) => h.toLowerCase())
    ),
  ].sort();

  if (!api || wanted.length === 0) {
    return new Map();
  }

  const key = wanted.join('|');

  if (recent?.key === key && Date.now() - recent.at < CACHE_MS) {
    return recent.result;
  }

  const result = readTorrents(api, wanted);
  recent = { key, at: Date.now(), result };
  return result;
};

const readTorrents = async (
  api: QbittorrentAPI,
  wanted: string[]
): Promise<Map<string, LiveProgress>> => {
  try {
    const torrents = await api.getTorrents(wanted);
    const now = Date.now();

    return new Map(
      torrents.map((torrent) => [
        torrent.hash.toLowerCase(),
        toLiveProgress(torrent, now),
      ])
    );
  } catch (e) {
    logger.debug('Unable to read live progress from qBittorrent', {
      label: 'Download Tracker',
      errorMessage: e.message,
    });
    return new Map();
  }
};
