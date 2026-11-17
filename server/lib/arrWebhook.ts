import { MediaType } from '@server/constants/media';
import type { DownloadingItem } from '@server/lib/downloadtracker';

/**
 * Radarr, Sonarr and Lidarr webhooks (Settings → Connect → Webhook). They
 * fire the moment something is grabbed or imported, where the *arr queues
 * only catch up with the download client about once a minute.
 */

export const ARR_SERVICES = ['radarr', 'sonarr', 'lidarr'] as const;
export type ArrService = (typeof ARR_SERVICES)[number];

export const isArrService = (value: unknown): value is ArrService =>
  ARR_SERVICES.includes(value as ArrService);

export interface ArrGrab {
  type: 'grab';
  /** The torrent hash, lowercase. */
  downloadId: string;
  size: number;
  /** Radarr/Sonarr: what their queue will show once it catches up. */
  items: DownloadingItem[];
  /** Lidarr: MusicBrainz ids. */
  albumIds: string[];
  artistId?: string;
}

export type ArrWebhookEvent =
  | ArrGrab
  /** Manual imports have no download id. */
  | { type: 'import'; downloadId?: string }
  | { type: 'test' }
  | { type: 'ignored'; eventType: string };

interface WebhookBody {
  eventType?: string;
  downloadId?: string;
  release?: { releaseTitle?: string; size?: number };
  movie?: { id?: number; title?: string };
  series?: { id?: number; title?: string };
  episodes?: {
    id?: number;
    seasonNumber?: number;
    episodeNumber?: number;
    absoluteEpisodeNumber?: number;
  }[];
  artist?: { mbId?: string; foreignArtistId?: string };
  albums?: { mbId?: string; foreignAlbumId?: string }[];
}

// Sonarr/Radarr v4+ also send ImportComplete once a whole download is in.
const IMPORT_EVENTS = new Set(['Download', 'ImportComplete']);

const grabItem = (
  body: WebhookBody,
  fields: Pick<DownloadingItem, 'mediaType' | 'externalId' | 'title'>,
  downloadId: string,
  size: number
): DownloadingItem => ({
  ...fields,
  size,
  sizeLeft: size,
  // No estimate until qBittorrent (or the queue) reports one.
  status: 'downloading',
  timeLeft: '',
  downloadId,
  title: body.release?.releaseTitle ?? fields.title,
});

export const parseArrWebhook = (
  service: ArrService,
  raw: unknown
): ArrWebhookEvent => {
  const body = (raw && typeof raw === 'object' ? raw : {}) as WebhookBody;
  const eventType = body.eventType ?? '';
  const downloadId = body.downloadId?.toLowerCase() || undefined;

  if (eventType === 'Test') {
    return { type: 'test' };
  }

  if (IMPORT_EVENTS.has(eventType)) {
    return { type: 'import', downloadId };
  }

  if (eventType !== 'Grab' || !downloadId) {
    return { type: 'ignored', eventType };
  }

  const size = Number(body.release?.size) || 0;
  const grab: ArrGrab = {
    type: 'grab',
    downloadId,
    size,
    items: [],
    albumIds: [],
  };

  if (service === 'radarr' && body.movie?.id) {
    grab.items.push(
      grabItem(
        body,
        {
          mediaType: MediaType.MOVIE,
          externalId: body.movie.id,
          title: body.movie.title ?? '',
        },
        downloadId,
        size
      )
    );
  }

  if (service === 'sonarr' && body.series?.id) {
    const episodes = body.episodes ?? [];
    // Like Sonarr's queue: one entry per episode, each with the full size.
    for (const episode of episodes.length ? episodes : [undefined]) {
      grab.items.push({
        ...grabItem(
          body,
          {
            mediaType: MediaType.TV,
            externalId: body.series.id,
            title: body.series.title ?? '',
          },
          downloadId,
          size
        ),
        episode:
          episode?.id !== undefined
            ? {
                id: episode.id,
                seasonNumber: episode.seasonNumber ?? 0,
                episodeNumber: episode.episodeNumber ?? 0,
                absoluteEpisodeNumber: episode.absoluteEpisodeNumber ?? 0,
              }
            : undefined,
      });
    }
  }

  if (service === 'lidarr') {
    grab.artistId = body.artist?.foreignArtistId ?? body.artist?.mbId;
    grab.albumIds = (body.albums ?? [])
      .map((album) => album.foreignAlbumId ?? album.mbId)
      .filter((id): id is string => !!id);
  }

  return grab;
};
