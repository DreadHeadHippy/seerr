import { MediaStatus } from '@server/constants/media';
import type Media from '@server/entity/Media';
import type { DownloadingItem } from '@server/lib/downloadtracker';

/** How often to check for a download starting on something requested. */
export const WAITING_FOR_DOWNLOAD_INTERVAL = 60 * 1000;

export const getRequestDownloadStatus = (
  downloadStatus: DownloadingItem[] | undefined,
  seasonNumbers: number[]
): DownloadingItem[] => {
  const items = downloadStatus ?? [];

  if (!seasonNumbers.length) {
    return items;
  }

  return items.filter(
    (item) => item.episode && seasonNumbers.includes(item.episode.seasonNumber)
  );
};

export const refreshIntervalHelper = (
  downloadItem: {
    downloadStatus: DownloadingItem[] | undefined;
    downloadStatus4k: DownloadingItem[] | undefined;
  },
  timer: number
) => {
  if (
    (downloadItem.downloadStatus ?? []).length > 0 ||
    (downloadItem.downloadStatus4k ?? []).length > 0
  ) {
    return timer;
  } else {
    return 0;
  }
};

export const mediaRefreshInterval = (
  media: Media | undefined,
  sawDownload: { current: boolean },
  timer: number
) => {
  if (
    refreshIntervalHelper(
      {
        downloadStatus: media?.downloadStatus,
        downloadStatus4k: media?.downloadStatus4k,
      },
      timer
    )
  ) {
    sawDownload.current = true;
    return timer;
  }

  // The queue empties before the media turns available, and briefly on every sync reset
  const processing = [media, ...(media?.seasons ?? [])].some(
    (item) =>
      item?.status === MediaStatus.PROCESSING ||
      item?.status4k === MediaStatus.PROCESSING
  );

  // Until a download shows up (the *arr is still searching), check now and
  // then so its progress and ETA appear without a reload.
  return processing
    ? sawDownload.current
      ? timer
      : WAITING_FOR_DOWNLOAD_INTERVAL
    : 0;
};

/** How often a title card re-checks a download it's showing progress for. */
export const CARD_DOWNLOAD_INTERVAL = 10 * 1000;

/** How often a card just requested from checks for its download starting. */
export const CARD_REQUESTED_INTERVAL = 15 * 1000;

/**
 * Refresh interval for a title card on screen: fast while downloading (the
 * server reads qBittorrent every 10 seconds) or just requested from the
 * card, slow while processing or awaiting approval, off once available or
 * never requested.
 */
export const cardRefreshInterval = (
  media: { status?: MediaStatus; downloadStatus?: DownloadingItem[] },
  requestedHere: boolean
): number => {
  if ((media.downloadStatus ?? []).length > 0) {
    return CARD_DOWNLOAD_INTERVAL;
  }

  const status = media.status;

  if (
    status === MediaStatus.AVAILABLE ||
    status === MediaStatus.BLOCKLISTED ||
    status === MediaStatus.DELETED
  ) {
    return 0;
  }

  if (!requestedHere) {
    return status === MediaStatus.PROCESSING
      ? WAITING_FOR_DOWNLOAD_INTERVAL
      : 0;
  }

  // Just requested from this card. Once approved the *arr usually grabs
  // within seconds; approval itself can take a while.
  return status === MediaStatus.PENDING
    ? WAITING_FOR_DOWNLOAD_INTERVAL
    : CARD_REQUESTED_INTERVAL;
};

/**
 * Refresh interval for a request card or row, from its latest data: fast
 * while downloading, slow while approved and waiting for a download to
 * start, otherwise off.
 */
export const requestRefreshInterval = (
  request:
    | {
        is4k?: boolean;
        media?: Pick<
          Media,
          'downloadStatus' | 'downloadStatus4k' | 'status' | 'status4k'
        >;
      }
    | undefined,
  timer: number
) => {
  const media = request?.media;

  if (!media) {
    return 0;
  }

  const downloads = request.is4k
    ? media.downloadStatus4k
    : media.downloadStatus;

  if ((downloads ?? []).length > 0) {
    return timer;
  }

  const status = request.is4k ? media.status4k : media.status;

  return status === MediaStatus.PROCESSING ? WAITING_FOR_DOWNLOAD_INTERVAL : 0;
};
