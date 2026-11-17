import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type { LiveSnapshot } from '@server/lib/downloadtracker';

/**
 * A download's numbers: a queue item (DownloadingItem), a music torrent, or
 * either with qBittorrent's live numbers merged in. Times arrive as JSON
 * strings whatever the type says.
 */
export interface ProgressDownload {
  size: number;
  sizeLeft: number;
  status: string;
  estimatedCompletionTime?: Date | string | null;
  downloadId?: string;
  episode?: { seasonNumber: number };
}

/**
 * - available: in the library
 * - importing: downloaded, waiting for the *arr and the library
 * - downloading: at least one torrent for it is in progress
 * - waiting: requested, nothing grabbed yet
 */
export type SeasonPhase = 'available' | 'importing' | 'downloading' | 'waiting';

/** Why a download has no ETA. */
export type StallReason = 'paused' | 'queued' | 'stalled';

export interface SeasonProgress {
  seasonNumber: number;
  phase: SeasonPhase;
  /** 0 to 1. */
  progress: number;
  /** Milliseconds until its last torrent finishes; undefined if unknown. */
  etaMs?: number;
  /** Downloading but without an ETA: why. */
  stalled?: StallReason;
}

/**
 * Why these downloads have no ETA, or undefined if they're all moving or
 * done. Paused or queued only when every unfinished one is; otherwise
 * stalled (no peers, no speed, or a client warning).
 */
export const stallReason = (
  downloads: ProgressDownload[]
): StallReason | undefined => {
  const unfinished = downloads.filter((d) => d.status !== 'completed');
  const noEta = unfinished.filter(
    (d) =>
      !d.estimatedCompletionTime ||
      !Number.isFinite(new Date(d.estimatedCompletionTime).getTime())
  );

  if (noEta.length === 0) {
    return undefined;
  }

  if (unfinished.every((d) => d.status === 'paused')) {
    return 'paused';
  }

  if (unfinished.every((d) => d.status === 'queued')) {
    return 'queued';
  }

  return 'stalled';
};

/** The downloads with qBittorrent's latest numbers where it has them. */
export const withLiveTorrents = <T extends ProgressDownload>(
  downloads: T[],
  live: LiveSnapshot
): T[] =>
  downloads.map((download) => {
    const torrent = download.downloadId
      ? live[download.downloadId.toLowerCase()]
      : undefined;

    return torrent
      ? {
          ...download,
          size: torrent.size,
          sizeLeft: torrent.sizeLeft,
          status: torrent.status,
          estimatedCompletionTime:
            torrent.estimatedCompletionTime as T['estimatedCompletionTime'],
        }
      : download;
  });

export interface TorrentProgress {
  progress: number;
  etaMs?: number;
  done: boolean;
}

/**
 * Progress across these downloads, counting each torrent once: Sonarr lists
 * a season pack once per episode, each with the whole pack's numbers.
 */
export const torrentProgress = (
  downloads: ProgressDownload[],
  now: number
): TorrentProgress => {
  const torrents = new Map<string, ProgressDownload>();

  downloads.forEach((download, index) => {
    torrents.set(download.downloadId?.toLowerCase() || `#${index}`, download);
  });

  let size = 0;
  let left = 0;
  let latestEta = 0;
  let unknown = false;
  let done = torrents.size > 0;

  for (const torrent of torrents.values()) {
    size += torrent.size || 0;

    if (torrent.status === 'completed') {
      continue;
    }

    done = false;
    left += torrent.sizeLeft || 0;
    const eta = torrent.estimatedCompletionTime
      ? new Date(torrent.estimatedCompletionTime).getTime()
      : NaN;

    if (Number.isFinite(eta)) {
      latestEta = Math.max(latestEta, eta);
    } else {
      // Queued, paused or stalled.
      unknown = true;
    }
  }

  if (done) {
    return { progress: 1, etaMs: 0, done: true };
  }

  return {
    progress: size > 0 ? Math.min(1, Math.max(0, 1 - left / size)) : 0,
    etaMs: unknown || !latestEta ? undefined : Math.max(0, latestEta - now),
    done: false,
  };
};

/**
 * The seasons a series' card follows: those requested (and not declined or
 * failed), plus any with a download. Specials are left out.
 */
export const followedSeasons = (
  requests: {
    is4k?: boolean;
    status: MediaRequestStatus;
    seasons: { seasonNumber: number }[];
  }[],
  downloads: ProgressDownload[]
): number[] => {
  const seasons = new Set<number>();

  for (const request of requests) {
    if (
      request.is4k ||
      request.status === MediaRequestStatus.DECLINED ||
      request.status === MediaRequestStatus.FAILED
    ) {
      continue;
    }

    request.seasons.forEach((season) => seasons.add(season.seasonNumber));
  }

  downloads.forEach((download) => {
    if (download.episode) {
      seasons.add(download.episode.seasonNumber);
    }
  });

  seasons.delete(0);
  return [...seasons].sort((a, b) => a - b);
};

/**
 * Where each season is. `seenDownloading` holds seasons a download was seen
 * for, so one that left the queue but isn't in the library yet reads as
 * importing rather than waiting.
 */
export const seasonProgress = (
  seasonNumbers: number[],
  seasonStatuses: { seasonNumber: number; status: MediaStatus }[],
  downloads: ProgressDownload[],
  seenDownloading: Set<number>,
  now: number
): SeasonProgress[] =>
  seasonNumbers.map((seasonNumber) => {
    const status = seasonStatuses.find(
      (season) => season.seasonNumber === seasonNumber
    )?.status;

    if (status === MediaStatus.AVAILABLE) {
      return { seasonNumber, phase: 'available', progress: 1 };
    }

    const own = downloads.filter(
      (download) => download.episode?.seasonNumber === seasonNumber
    );

    if (own.length > 0) {
      const torrents = torrentProgress(own, now);

      return torrents.done
        ? { seasonNumber, phase: 'importing', progress: 1 }
        : {
            seasonNumber,
            phase: 'downloading',
            progress: torrents.progress,
            etaMs: torrents.etaMs,
            stalled:
              torrents.etaMs === undefined ? stallReason(own) : undefined,
          };
    }

    return seenDownloading.has(seasonNumber)
      ? { seasonNumber, phase: 'importing', progress: 1 }
      : { seasonNumber, phase: 'waiting', progress: 0 };
  });

export interface SeriesProgress {
  /** Average over the seasons, each counting the same. */
  progress: number;
  /** When the last downloading season finishes; undefined if unknown. */
  etaMs?: number;
  /** Seasons in the library. */
  ready: number[];
  /** Nothing left downloading or waiting; only imports to finish. */
  importing: boolean;
}

export const seriesProgress = (seasons: SeasonProgress[]): SeriesProgress => {
  const downloading = seasons.filter((s) => s.phase === 'downloading');

  return {
    progress: seasons.length
      ? seasons.reduce((sum, s) => sum + s.progress, 0) / seasons.length
      : 0,
    etaMs:
      downloading.length === 0 || downloading.some((s) => s.etaMs === undefined)
        ? undefined
        : Math.max(...downloading.map((s) => s.etaMs ?? 0)),
    ready: seasons
      .filter((s) => s.phase === 'available')
      .map((s) => s.seasonNumber),
    importing:
      seasons.some((s) => s.phase === 'importing') &&
      seasons.every((s) => s.phase === 'importing' || s.phase === 'available'),
  };
};

/** "S1–3, S5": seasons as compact ranges. */
export const formatSeasonRanges = (seasons: number[]): string => {
  const sorted = [...new Set(seasons)].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0];
  let previous = sorted[0];

  for (const season of [...sorted.slice(1), undefined]) {
    if (season !== undefined && season === previous + 1) {
      previous = season;
      continue;
    }

    if (start !== undefined) {
      ranges.push(start === previous ? `S${start}` : `S${start}–${previous}`);
    }

    start = season as number;
    previous = season as number;
  }

  return ranges.join(', ');
};
