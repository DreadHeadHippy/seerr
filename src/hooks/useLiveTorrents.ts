import {
  withLiveTorrents,
  type ProgressDownload,
} from '@app/utils/seasonProgress';
import type { LiveSnapshot } from '@server/lib/downloadtracker';
import { useMemo, useSyncExternalStore } from 'react';

/*
 * One EventSource for the whole page, open while anything is showing a
 * download, so everything on the page shares a single connection.
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
 * qBittorrent's numbers by lowercase torrent hash, pushed live (about every
 * 1.5 seconds) while `enabled`.
 */
export const useLiveTorrents = (enabled: boolean): LiveSnapshot =>
  useSyncExternalStore(
    enabled ? subscribe : noSubscription,
    () => (enabled ? snapshot : EMPTY),
    () => EMPTY
  );

/**
 * These downloads with qBittorrent's live numbers (size, size left, status,
 * ETA) in place of the queue's, for anything that shows their progress.
 */
export const useLiveDownloads = <T extends ProgressDownload>(
  downloads: T[] | undefined
): T[] => {
  const live = useLiveTorrents((downloads ?? []).length > 0);

  return useMemo(
    () => withLiveTorrents(downloads ?? [], live),
    [downloads, live]
  );
};
