import type {
  DownloadingItem,
  LiveSnapshot,
} from '@server/lib/downloadtracker';
import { useSyncExternalStore } from 'react';

type Download = Pick<
  DownloadingItem,
  'size' | 'sizeLeft' | 'status' | 'estimatedCompletionTime'
> & { downloadId?: string };

export interface LiveDownloadState {
  /** 0 to 1. */
  progress: number;
  /** Milliseconds until the slowest download finishes; undefined if unknown. */
  etaMs?: number;
  /** Everything downloaded; the *arr is importing it. */
  done: boolean;
}

/** The downloads with qBittorrent's latest numbers where it has them. */
export const withLiveTorrents = <T extends Download>(
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
          estimatedCompletionTime: torrent.estimatedCompletionTime as
            | Date
            | undefined,
        }
      : download;
  });

/** Progress and ETA across these downloads, as reported. */
export const downloadState = (
  downloads: Download[],
  now: number
): LiveDownloadState => {
  let size = 0;
  let left = 0;
  let latestEta = 0;
  let unknown = false;
  let done = downloads.length > 0;

  for (const download of downloads) {
    size += download.size || 0;

    if (download.status === 'completed') {
      continue;
    }

    done = false;
    left += download.sizeLeft || 0;
    const eta = download.estimatedCompletionTime
      ? new Date(download.estimatedCompletionTime).getTime()
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

/*
 * One EventSource for the whole page, open while any card is showing a
 * download, so the cards share a single connection.
 */
const EMPTY: LiveSnapshot = {};
let snapshot: LiveSnapshot = EMPTY;
let source: EventSource | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  clearTimeout(closeTimer);

  if (!source) {
    source = new EventSource('/api/v1/downloads/live');
    source.onmessage = (event) => {
      try {
        snapshot = JSON.parse(event.data);
        listeners.forEach((notify) => notify());
      } catch {
        // A partial or malformed message; the next one replaces it.
      }
    };
    // EventSource reconnects by itself after errors.
  }

  return () => {
    listeners.delete(listener);

    // Scrolling cards in and out shouldn't reconnect every time.
    if (listeners.size === 0) {
      closeTimer = setTimeout(() => {
        source?.close();
        source = undefined;
        snapshot = EMPTY;
      }, 10 * 1000);
    }
  };
};

const noSubscription = () => () => undefined;

/**
 * Progress for these downloads from qBittorrent, pushed live (about every
 * 1.5 seconds) while `enabled`; the given numbers until the first push.
 */
const useLiveDownload = (
  downloads: Download[],
  enabled: boolean
): LiveDownloadState => {
  const live = useSyncExternalStore(
    enabled ? subscribe : noSubscription,
    () => (enabled ? snapshot : EMPTY),
    () => EMPTY
  );
  return downloadState(withLiveTorrents(downloads, live), Date.now());
};

export default useLiveDownload;
