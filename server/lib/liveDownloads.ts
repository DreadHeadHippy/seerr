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

/** Same hashes within a second share one qBittorrent call. */
const CACHE_MS = 1000;
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

/** Problems reading qBittorrent are warned about at most this often. */
const WARN_EVERY_MS = 5 * 60 * 1000;
let lastWarning = 0;

/**
 * The last reading qBittorrent gave for each torrent. A failed read shows
 * these rather than falling back to the *arr queues, which lag well behind.
 */
const lastGood = new Map<string, LiveProgress>();

/** Readings for torrents nobody asks about any more are dropped past this. */
const LAST_GOOD_LIMIT = 200;

/** The last good readings for these hashes. */
export const lastGoodReadings = (
  wanted: string[],
  readings: Map<string, LiveProgress> = lastGood
): Map<string, LiveProgress> =>
  new Map(
    wanted.flatMap((hash) => {
      const reading = readings.get(hash);
      return reading ? [[hash, reading] as const] : [];
    })
  );

const readTorrents = async (
  api: QbittorrentAPI,
  wanted: string[]
): Promise<Map<string, LiveProgress>> => {
  try {
    const torrents = await api.getTorrents(wanted);
    const now = Date.now();
    const live = new Map(
      torrents.map((torrent) => [
        torrent.hash.toLowerCase(),
        toLiveProgress(torrent, now),
      ])
    );
    const missing = wanted.filter((hash) => !live.has(hash));

    // Kept per hash, so readings for other callers' torrents survive too.
    // A torrent qBittorrent no longer has is gone for real; forget it.
    for (const hash of wanted) {
      const reading = live.get(hash);

      if (reading) {
        lastGood.set(hash, reading);
      } else {
        lastGood.delete(hash);
      }
    }

    if (lastGood.size > LAST_GOOD_LIMIT) {
      const keep = new Set(wanted);
      [...lastGood.keys()]
        .filter((hash) => !keep.has(hash))
        .forEach((hash) => lastGood.delete(hash));
    }

    if (missing.length > 0) {
      // Usually a torrent the *arr hasn't sent yet, or one already removed.
      logger.debug(
        `qBittorrent doesn't have ${missing.length} of ${wanted.length} tracked torrent(s); using the *arr queue for those`,
        { label: 'Download Tracker', missing }
      );
    }

    return live;
  } catch (e) {
    if (Date.now() - lastWarning > WARN_EVERY_MS) {
      lastWarning = Date.now();
      logger.warn(
        'Unable to read live progress from qBittorrent; showing its last readings until it answers again',
        { label: 'Download Tracker', errorMessage: e.message }
      );
    }

    return lastGoodReadings(wanted);
  }
};
