import type { DownloadingItem } from '@server/lib/downloadtracker';
import { useEffect, useState } from 'react';

type Download = Pick<
  DownloadingItem,
  'size' | 'sizeLeft' | 'status' | 'estimatedCompletionTime'
>;

export interface LiveDownloadState {
  /** 0 to 1. */
  progress: number;
  /** Milliseconds until the slowest download finishes; undefined if unknown. */
  etaMs?: number;
  /** Everything downloaded; the *arr is importing it. */
  done: boolean;
}

/** Never shown as finished until a reading says so. */
const MAX_GUESSED_PROGRESS = 0.99;

/**
 * Where these downloads should be `now`, carrying on from the reading taken
 * at `readAt` at the speed its ETA implies. Between the server's readings
 * (every 10 seconds) this keeps the ring filling like qBittorrent's own.
 */
export const liveDownloadState = (
  downloads: Download[],
  readAt: number,
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
    const sizeLeft = download.sizeLeft || 0;
    const eta = download.estimatedCompletionTime
      ? new Date(download.estimatedCompletionTime).getTime()
      : NaN;

    if (Number.isFinite(eta) && eta > readAt) {
      const elapsed = Math.max(0, now - readAt);
      left += Math.max(0, sizeLeft * (1 - elapsed / (eta - readAt)));
      latestEta = Math.max(latestEta, eta);
    } else {
      // Queued, paused or stalled: no speed to carry on with.
      left += sizeLeft;
      unknown = true;
    }
  }

  if (done) {
    return { progress: 1, etaMs: 0, done: true };
  }

  const progress = size > 0 ? Math.max(0, 1 - left / size) : 0;

  return {
    progress: Math.min(MAX_GUESSED_PROGRESS, progress),
    etaMs: unknown || !latestEta ? undefined : Math.max(0, latestEta - now),
    done: false,
  };
};

/** liveDownloadState, ticking every second while there are downloads. */
const useLiveDownload = (downloads: Download[]): LiveDownloadState => {
  const [readAt, setReadAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  // A new reading arrived: carry on from here. Keyed on the numbers, since
  // callers build a fresh array each render.
  const reading = downloads
    .map(
      (d) =>
        `${d.sizeLeft}:${d.status}:${
          d.estimatedCompletionTime
            ? new Date(d.estimatedCompletionTime).getTime()
            : ''
        }`
    )
    .join('|');

  useEffect(() => {
    const time = Date.now();
    setReadAt(time);
    setNow(time);
  }, [reading]);

  const active = downloads.length > 0;

  useEffect(() => {
    if (!active) {
      return;
    }

    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  return liveDownloadState(downloads, readAt, now);
};

export default useLiveDownload;
