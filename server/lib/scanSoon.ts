import { MediaServerType } from '@server/constants/server';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

/**
 * Time for the *arr to import a finished download and the media server to
 * pick it up before we look.
 */
const SCAN_DELAY_MS = 2 * 60 * 1000;

/**
 * After an *arr says it imported something: just the media server noticing
 * the new files.
 */
const IMPORTED_SCAN_DELAY_MS = 30 * 1000;

let timer: ReturnType<typeof setTimeout> | undefined;
let dueAt = 0;

/** Runs a recently added scan now, unless one is already running. */
const runRecentScan = async (reason: string): Promise<void> => {
  try {
    const mediaServerType = getSettings().main.mediaServerType;

    // Imported here: the scanners import Media, which imports the
    // download tracker that calls this.
    const scanner =
      mediaServerType === MediaServerType.PLEX
        ? (await import('@server/lib/scanners/plex')).plexRecentScanner
        : mediaServerType === MediaServerType.JELLYFIN ||
            mediaServerType === MediaServerType.EMBY
          ? (await import('@server/lib/scanners/jellyfin'))
              .jellyfinRecentScanner
          : undefined;

    if (!scanner || scanner.status().running) {
      return;
    }

    logger.info(`${reason}, scanning for recently added media`, {
      label: 'Download Tracker',
    });
    scanner.run();
  } catch (e) {
    logger.error('Failed to start a recently added scan', {
      label: 'Download Tracker',
      errorMessage: e.message,
    });
  }
};

/**
 * Runs a recently added scan shortly, so a finished download shows as
 * available (and requesters are notified) without waiting for the next
 * scheduled scan. Calls in quick succession share one scan (the earliest
 * asked for), and a scan that is already running is left alone.
 */
export const scanMediaServerSoon = (delayMs = SCAN_DELAY_MS): void => {
  const due = Date.now() + delayMs;

  if (timer) {
    if (due >= dueAt) {
      return;
    }

    clearTimeout(timer);
  }

  dueAt = due;
  timer = setTimeout(() => {
    timer = undefined;
    runRecentScan('A download finished');
  }, delayMs);
};

/** After an import, how often to look and for how long. */
const IMPORT_FOLLOW_UP_EVERY_MS = 45 * 1000;
const IMPORT_FOLLOW_UP_FOR_MS = 5 * 60 * 1000;

let followUntil = 0;
let followTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * An *arr imported something. The media server takes a moment to add and
 * match it, and a scan before then finds nothing, so scan shortly and then
 * every 45 seconds for 5 minutes (from the latest import) rather than once.
 */
export const scanAfterImport = (): void => {
  followUntil = Date.now() + IMPORT_FOLLOW_UP_FOR_MS;

  if (followTimer) {
    return;
  }

  const tick = () => {
    if (Date.now() > followUntil) {
      followTimer = undefined;
      return;
    }

    runRecentScan('Media was imported');
    followTimer = setTimeout(tick, IMPORT_FOLLOW_UP_EVERY_MS);
  };

  followTimer = setTimeout(tick, IMPORTED_SCAN_DELAY_MS);
};

/** Whether any download in `previous` is no longer in the queue. */
export const anyDownloadLeft = (
  previous: { downloadId: string }[] | undefined,
  currentIds: string[]
): boolean => {
  if (!previous?.length) {
    return false;
  }

  const current = new Set(currentIds);
  return previous.some((item) => !current.has(item.downloadId));
};
