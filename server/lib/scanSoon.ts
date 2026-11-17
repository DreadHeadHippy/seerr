import { MediaServerType } from '@server/constants/server';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

/**
 * Time for the *arr to import a finished download and the media server to
 * pick it up before we look.
 */
const SCAN_DELAY_MS = 2 * 60 * 1000;

let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Runs a recently added scan shortly, so a finished download shows as
 * available (and requesters are notified) without waiting for the next
 * scheduled scan. Calls in quick succession share one scan, and a scan that
 * is already running is left alone.
 */
export const scanMediaServerSoon = (): void => {
  if (timer) {
    return;
  }

  timer = setTimeout(async () => {
    timer = undefined;

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

      logger.info('A download finished, scanning for recently added media', {
        label: 'Download Tracker',
      });
      scanner.run();
    } catch (e) {
      logger.error('Failed to start a recently added scan', {
        label: 'Download Tracker',
        errorMessage: e.message,
      });
    }
  }, SCAN_DELAY_MS);
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
