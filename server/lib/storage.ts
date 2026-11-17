import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import { MediaRequestStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { MediaRequest } from '@server/entity/MediaRequest';
import type { User } from '@server/entity/User';
import downloadTracker from '@server/lib/downloadtracker';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { In } from 'typeorm';

const GB = 1024 ** 3;

/** One title's share of a user's storage. */
export interface StorageItem {
  mediaId: number;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  /** Their share: on disk plus downloading, split between requesters. */
  bytes: number;
  /** Series: the seasons they requested. */
  seasons?: number[];
  /** Others requested it too, so it's shared. */
  shared: boolean;
}

export interface StorageUsage {
  usedBytes: number;
  /** Undefined when unlimited. */
  limitBytes?: number;
  /** At or over the limit: new requests are refused. */
  restricted: boolean;
  items: StorageItem[];
}

/** A request, reduced to what the split needs. */
export interface ShareRequest {
  userId: number;
  mediaId: number;
  is4k: boolean;
  /** Series: requested seasons. Movies: empty. */
  seasons: number[];
}

/** A title's size: whole for a movie, per season for a series. */
export interface ShareSize {
  total?: number;
  seasons?: Map<number, number>;
}

/**
 * A user's share of each title they requested. A movie splits evenly
 * between everyone who requested it; a series by season, each season
 * between the users who requested that season.
 */
export const userShares = (
  userId: number,
  requests: ShareRequest[],
  sizeOf: (mediaId: number, is4k: boolean) => ShareSize | undefined
): {
  mediaId: number;
  is4k: boolean;
  bytes: number;
  seasons: number[];
  shared: boolean;
}[] => {
  const mine = new Map<string, ShareRequest>();

  for (const request of requests.filter((r) => r.userId === userId)) {
    const key = `${request.mediaId}:${request.is4k}`;
    const existing = mine.get(key);
    mine.set(key, {
      ...request,
      seasons: [...new Set([...(existing?.seasons ?? []), ...request.seasons])],
    });
  }

  return [...mine.values()].map((request) => {
    const others = requests.filter(
      (r) =>
        r.mediaId === request.mediaId &&
        r.is4k === request.is4k &&
        r.userId !== userId
    );
    const size = sizeOf(request.mediaId, request.is4k);
    let bytes = 0;
    let shared = false;

    if (request.seasons.length === 0) {
      const requesters = new Set([userId, ...others.map((r) => r.userId)]);
      bytes = (size?.total ?? 0) / requesters.size;
      shared = requesters.size > 1;
    } else {
      for (const season of request.seasons) {
        const requesters = new Set([
          userId,
          ...others
            .filter((r) => r.seasons.includes(season))
            .map((r) => r.userId),
        ]);
        bytes += (size?.seasons?.get(season) ?? 0) / requesters.size;
        shared ||= requesters.size > 1;
      }
    }

    return {
      mediaId: request.mediaId,
      is4k: request.is4k,
      bytes,
      seasons: request.seasons,
      shared,
    };
  });
};

/** The user's limit in bytes, or undefined when unlimited. */
export const storageLimitBytes = (user: User): number | undefined => {
  // Admins and user managers aren't limited, as with request quotas.
  if (user.hasPermission([Permission.MANAGE_USERS], { type: 'or' })) {
    return undefined;
  }

  const gb =
    user.storageLimitGb ?? getSettings().main.defaultStorageLimitGb ?? 0;

  return gb > 0 ? gb * GB : undefined;
};

/*
 * Radarr and Sonarr libraries, a few minutes old at most. Asked for on every
 * request and storage view; a full library list each time is wasteful.
 */
const LIBRARY_CACHE_MS = 5 * 60 * 1000;
const movieSizes = new Map<
  number,
  { at: number; sizes: Promise<Map<number, number>> }
>();
const seriesSizes = new Map<
  number,
  { at: number; sizes: Promise<Map<number, Map<number, number>>> }
>();

const radarrSizes = (serverId: number): Promise<Map<number, number>> => {
  const cached = movieSizes.get(serverId);

  if (cached && Date.now() - cached.at < LIBRARY_CACHE_MS) {
    return cached.sizes;
  }

  const server = getSettings().radarr.find((s) => s.id === serverId);
  const sizes = server
    ? new RadarrAPI({
        apiKey: server.apiKey,
        url: RadarrAPI.buildUrl(server, '/api/v3'),
      })
        .getMovies()
        .then(
          (movies) =>
            new Map(
              movies.map((movie) => [
                movie.id,
                movie.sizeOnDisk ?? movie.movieFile?.size ?? 0,
              ])
            )
        )
        .catch((e) => {
          movieSizes.delete(serverId);
          throw e;
        })
    : Promise.resolve(new Map<number, number>());

  movieSizes.set(serverId, { at: Date.now(), sizes });
  return sizes;
};

const sonarrSizes = (
  serverId: number
): Promise<Map<number, Map<number, number>>> => {
  const cached = seriesSizes.get(serverId);

  if (cached && Date.now() - cached.at < LIBRARY_CACHE_MS) {
    return cached.sizes;
  }

  const server = getSettings().sonarr.find((s) => s.id === serverId);
  const sizes = server
    ? new SonarrAPI({
        apiKey: server.apiKey,
        url: SonarrAPI.buildUrl(server, '/api/v3'),
      })
        .getSeries()
        .then(
          (series) =>
            new Map(
              series.map((show) => [
                show.id as number,
                new Map(
                  show.seasons.map((season) => [
                    season.seasonNumber,
                    season.statistics?.sizeOnDisk ?? 0,
                  ])
                ),
              ])
            )
        )
        .catch((e) => {
          seriesSizes.delete(serverId);
          throw e;
        })
    : Promise.resolve(new Map<number, Map<number, number>>());

  seriesSizes.set(serverId, { at: Date.now(), sizes });
  return sizes;
};

/** Forget cached library sizes, e.g. after deleting something. */
export const clearStorageCache = (): void => {
  movieSizes.clear();
  seriesSizes.clear();
};

/** Bytes still to come for downloads, each torrent counted once. */
const downloadingBytes = (
  items: { downloadId: string; size: number }[]
): number =>
  [
    ...new Map(
      items.map((item) => [item.downloadId || '', item.size])
    ).values(),
  ].reduce((sum, size) => sum + (size || 0), 0);

/** What a user's requests take up, against their limit. */
export const getStorageUsage = async (user: User): Promise<StorageUsage> => {
  const limitBytes = storageLimitBytes(user);
  const requestRepository = getRepository(MediaRequest);
  const counted = [
    MediaRequestStatus.PENDING,
    MediaRequestStatus.APPROVED,
    MediaRequestStatus.COMPLETED,
  ];

  const mine = await requestRepository.find({
    where: { requestedBy: { id: user.id }, status: In(counted) },
  });
  const mediaIds = [...new Set(mine.map((r) => r.media.id))];

  if (mediaIds.length === 0) {
    return { usedBytes: 0, limitBytes, restricted: false, items: [] };
  }

  // Everyone's requests on those titles, for the split.
  const all = await requestRepository.find({
    where: { media: { id: In(mediaIds) }, status: In(counted) },
  });
  const media = new Map(all.map((r) => [r.media.id, r.media]));
  const sizes = new Map<string, ShareSize>();

  await Promise.all(
    [...media.values()].flatMap((m) =>
      [false, true].map(async (is4k) => {
        const serviceId = is4k ? m.serviceId4k : m.serviceId;
        const externalId = is4k ? m.externalServiceId4k : m.externalServiceId;

        if (
          serviceId === null ||
          serviceId === undefined ||
          externalId === null ||
          externalId === undefined
        ) {
          return;
        }

        try {
          if (m.mediaType === MediaType.MOVIE) {
            const onDisk = (await radarrSizes(serviceId)).get(externalId) ?? 0;
            const queued = downloadingBytes(
              downloadTracker.getMovieProgress(serviceId, externalId)
            );
            sizes.set(`${m.id}:${is4k}`, { total: onDisk + queued });
          } else {
            const onDisk = new Map(
              (await sonarrSizes(serviceId)).get(externalId) ?? []
            );

            // A pack covering several seasons is shared between them.
            const queue = downloadTracker.getSeriesProgress(
              serviceId,
              externalId
            );
            const torrents = new Map<
              string,
              { size: number; seasons: Set<number> }
            >();
            for (const item of queue) {
              const torrent = torrents.get(item.downloadId) ?? {
                size: item.size,
                seasons: new Set<number>(),
              };
              if (item.episode) {
                torrent.seasons.add(item.episode.seasonNumber);
              }
              torrents.set(item.downloadId, torrent);
            }
            for (const torrent of torrents.values()) {
              for (const season of torrent.seasons) {
                onDisk.set(
                  season,
                  (onDisk.get(season) ?? 0) +
                    torrent.size / torrent.seasons.size
                );
              }
            }

            sizes.set(`${m.id}:${is4k}`, { seasons: onDisk });
          }
        } catch (e) {
          logger.debug('Unable to read sizes for storage usage', {
            label: 'Storage',
            mediaId: m.id,
            errorMessage: e.message,
          });
        }
      })
    )
  );

  const shares = userShares(
    user.id,
    all.map((r) => ({
      userId: r.requestedBy.id,
      mediaId: r.media.id,
      is4k: r.is4k,
      seasons:
        r.type === MediaType.TV
          ? (r.seasons ?? []).map((s) => s.seasonNumber)
          : [],
    })),
    (mediaId, is4k) => sizes.get(`${mediaId}:${is4k}`)
  );

  const items: StorageItem[] = shares
    .filter((share) => share.bytes > 0)
    .map((share) => {
      const m = media.get(share.mediaId);

      return {
        mediaId: share.mediaId,
        tmdbId: m?.tmdbId ?? 0,
        mediaType: (m?.mediaType === MediaType.TV
          ? 'tv'
          : 'movie') as StorageItem['mediaType'],
        bytes: Math.round(share.bytes),
        seasons: share.seasons.length ? share.seasons : undefined,
        shared: share.shared,
      };
    })
    .sort((a, b) => b.bytes - a.bytes);
  const usedBytes = items.reduce((sum, item) => sum + item.bytes, 0);

  return {
    usedBytes,
    limitBytes,
    restricted: limitBytes !== undefined && usedBytes >= limitBytes,
    items,
  };
};
