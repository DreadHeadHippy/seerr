import type LidarrAPI from '@server/api/servarr/lidarr';
import type { MusicDownload } from '@server/interfaces/api/musicInterfaces';
import { fetchLiveProgress } from '@server/lib/liveDownloads';
import logger from '@server/logger';

/**
 * Time from a finished download to playable in Plex: Lidarr importing the
 * files and Plex picking them up. Rough, since the ETA is shown as approximate.
 */
const IMPORT_BUFFER_MS = 5 * 60 * 1000;

const IMPORTING_STATES = new Set(['importPending', 'importing']);

export interface MusicDownloads {
  albums: Map<string, MusicDownload>;
  artists: Map<string, MusicDownload>;
}

const EMPTY: MusicDownloads = { albums: new Map(), artists: new Map() };

interface Tally {
  size: number;
  sizeleft: number;
  /** Latest ready time across the parts; undefined once any part has none. */
  readyAt: number | undefined;
  unknown: boolean;
}

const add = (
  map: Map<string, Tally>,
  key: string | undefined,
  size: number,
  sizeleft: number,
  readyAt: number | undefined
) => {
  if (!key) {
    return;
  }

  const entry = map.get(key) ?? {
    size: 0,
    sizeleft: 0,
    readyAt: 0,
    unknown: false,
  };
  entry.size += size;
  entry.sizeleft += sizeleft;

  if (readyAt === undefined) {
    entry.unknown = true;
  } else {
    entry.readyAt = Math.max(entry.readyAt ?? 0, readyAt);
  }

  map.set(key, entry);
};

const finish = (map: Map<string, Tally>): Map<string, MusicDownload> =>
  new Map(
    [...map].map(([key, entry]) => [
      key,
      {
        progress:
          entry.size > 0
            ? Math.min(1, Math.max(0, 1 - entry.sizeleft / entry.size))
            : 0,
        readyAt:
          !entry.unknown && entry.readyAt
            ? new Date(entry.readyAt).toISOString()
            : undefined,
      },
    ])
  );

/**
 * What is downloading for Lidarr right now, by album and by artist, with an
 * approximate time until it is playable. Never throws: without the queue the
 * Music page simply shows no ETAs.
 */
export const getMusicDownloads = async (
  lidarr: LidarrAPI
): Promise<MusicDownloads> => {
  try {
    const queue = await lidarr.getDownloadQueue();
    // Lidarr's queue lags its download client; qBittorrent's numbers don't.
    const live = await fetchLiveProgress(queue.map((item) => item.downloadId));
    const now = Date.now();
    const albums = new Map<string, Tally>();
    const artists = new Map<string, Tally>();

    for (const item of queue) {
      if (item.trackedDownloadState === 'failed') {
        continue;
      }

      const torrent = item.downloadId
        ? live.get(item.downloadId.toLowerCase())
        : undefined;
      const size = torrent?.size ?? item.size;
      const sizeleft = torrent?.sizeLeft ?? item.sizeleft;
      const eta = torrent
        ? (torrent.estimatedCompletionTime?.getTime() ?? NaN)
        : item.estimatedCompletionTime
          ? Date.parse(item.estimatedCompletionTime)
          : NaN;
      const readyAt =
        IMPORTING_STATES.has(item.trackedDownloadState) ||
        torrent?.status === 'completed'
          ? now + IMPORT_BUFFER_MS
          : Number.isFinite(eta)
            ? Math.max(eta, now) + IMPORT_BUFFER_MS
            : // Queued, paused or stalled: no honest estimate.
              undefined;

      add(albums, item.album?.foreignAlbumId, size, sizeleft, readyAt);
      add(artists, item.artist?.foreignArtistId, size, sizeleft, readyAt);
    }

    return { albums: finish(albums), artists: finish(artists) };
  } catch (e) {
    logger.debug('Unable to read the Lidarr queue', {
      label: 'Music Discovery',
      errorMessage: e.message,
    });

    return EMPTY;
  }
};

type WithIds = {
  foreignAlbumId?: string;
  foreignArtistId?: string;
  download?: MusicDownload;
};

const withDownload = <T>(item: T, downloads: MusicDownloads): T => {
  if (!item || typeof item !== 'object') {
    return item;
  }

  const ids = item as WithIds;
  const download = ids.foreignAlbumId
    ? downloads.albums.get(ids.foreignAlbumId)
    : ids.foreignArtistId
      ? downloads.artists.get(ids.foreignArtistId)
      : undefined;

  return download ? { ...item, download } : item;
};

/**
 * Adds download ETAs to a Music response: `results` and `releases` lists
 * (artists or albums) and a top-level `artist`.
 */
export const attachDownloads = <T>(
  response: T,
  downloads: MusicDownloads
): T => {
  if (
    (downloads.albums.size === 0 && downloads.artists.size === 0) ||
    !response ||
    typeof response !== 'object'
  ) {
    return response;
  }

  const result = { ...response } as Record<string, unknown>;

  for (const key of ['results', 'releases']) {
    const list = result[key];

    if (Array.isArray(list)) {
      result[key] = list.map((item) => withDownload(item, downloads));
    }
  }

  if (result.artist) {
    result.artist = withDownload(result.artist, downloads);
  }

  return result as T;
};
