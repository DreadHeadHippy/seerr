import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import TheMovieDb from '@server/api/themoviedb';
import {
  DeletionMode,
  DeletionRequestStatus,
} from '@server/constants/deletion';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import DeletionRequest from '@server/entity/DeletionRequest';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import type { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { clearStorageCache } from '@server/lib/storage';
import logger from '@server/logger';
import { In } from 'typeorm';

/** What this user may do with media they requested. */
export const deletionModeFor = (user: User): DeletionMode => {
  // Admins already manage everything.
  if (user.hasPermission(Permission.MANAGE_REQUESTS)) {
    return DeletionMode.DIRECT;
  }

  return (
    user.deletionMode ??
    getSettings().main.defaultDeletionMode ??
    DeletionMode.NONE
  );
};

export interface OwnedSeason {
  seasonNumber: number;
  /** Someone else requested it too. */
  shared: boolean;
}

export interface Ownership {
  /** They requested (part of) it. */
  owns: boolean;
  /** Movie: someone else requested it too. */
  shared: boolean;
  /** Series: the seasons they requested. */
  seasons: OwnedSeason[];
}

/**
 * What of a title is the user's: a movie they requested, or the seasons
 * of a series they requested, each marked shared when others requested it
 * too. Shared parts can only be asked for, not deleted outright.
 */
export const ownership = (
  userId: number,
  mediaType: MediaType,
  requests: { userId: number; seasons: number[] }[]
): Ownership => {
  const mine = requests.filter((r) => r.userId === userId);
  const others = requests.filter((r) => r.userId !== userId);

  if (mediaType === MediaType.MOVIE) {
    return { owns: mine.length > 0, shared: others.length > 0, seasons: [] };
  }

  const seasons = [...new Set(mine.flatMap((r) => r.seasons))]
    .filter((n) => n > 0)
    .sort((a, b) => a - b);

  return {
    owns: seasons.length > 0,
    shared: false,
    seasons: seasons.map((seasonNumber) => ({
      seasonNumber,
      shared: others.some((r) => r.seasons.includes(seasonNumber)),
    })),
  };
};

/** Requests that count as asking for it (not declined or failed). */
const OWNING_STATUSES = [
  MediaRequestStatus.PENDING,
  MediaRequestStatus.APPROVED,
  MediaRequestStatus.COMPLETED,
];

export const loadOwnership = async (
  user: User,
  media: Media
): Promise<Ownership> => {
  const requests = await getRepository(MediaRequest).find({
    where: {
      media: { id: media.id },
      is4k: false,
      status: In(OWNING_STATUSES),
    },
  });

  return ownership(
    user.id,
    media.mediaType,
    requests.map((r) => ({
      userId: r.requestedBy.id,
      seasons: (r.seasons ?? []).map((s) => s.seasonNumber),
    }))
  );
};

/** Seasons still in the library or on their way. */
const presentSeasons = (media: Media): number[] =>
  media.seasons
    .filter(
      (s) =>
        s.seasonNumber > 0 &&
        s.status !== MediaStatus.UNKNOWN &&
        s.status !== MediaStatus.DELETED
    )
    .map((s) => s.seasonNumber);

/**
 * Deletes a movie, or some seasons of a series, from Radarr/Sonarr with its
 * files, and marks it deleted in Seerr. Seasons covering everything left
 * of a series delete the whole series. Plex drops the files on its next
 * library scan (with "Empty trash automatically" on).
 */
export const deleteMedia = async (
  media: Media,
  seasons: number[] = []
): Promise<void> => {
  const settings = getSettings();
  const mediaRepository = getRepository(Media);

  if (media.mediaType === MediaType.MOVIE) {
    const server = settings.radarr.find((s) => s.id === media.serviceId);

    if (!server) {
      throw new Error('The movie is not in a configured Radarr server');
    }

    await new RadarrAPI({
      apiKey: server.apiKey,
      url: RadarrAPI.buildUrl(server, '/api/v3'),
    }).removeMovie(media.tmdbId);

    media.status = MediaStatus.DELETED;
    media.resetServiceData(false);
  } else {
    const server = settings.sonarr.find((s) => s.id === media.serviceId);

    if (!server) {
      throw new Error('The series is not in a configured Sonarr server');
    }

    const sonarr = new SonarrAPI({
      apiKey: server.apiKey,
      url: SonarrAPI.buildUrl(server, '/api/v3'),
    });
    const present = presentSeasons(media);
    const whole =
      seasons.length === 0 || present.every((n) => seasons.includes(n));

    if (whole) {
      const tvdbId =
        media.tvdbId ??
        (await new TheMovieDb().getTvShow({ tvId: media.tmdbId })).external_ids
          .tvdb_id;

      if (!tvdbId) {
        throw new Error('TVDB ID not found');
      }

      await sonarr.removeSeries(tvdbId);

      for (const season of media.seasons) {
        season.status = MediaStatus.DELETED;
      }

      media.status = MediaStatus.DELETED;
      media.resetServiceData(false);
    } else {
      if (
        media.externalServiceId === null ||
        media.externalServiceId === undefined
      ) {
        throw new Error('The series is not in Sonarr');
      }

      await sonarr.removeSeasons(media.externalServiceId, seasons);

      for (const season of media.seasons) {
        if (seasons.includes(season.seasonNumber)) {
          season.status = MediaStatus.DELETED;
        }
      }

      const remaining = media.seasons.filter(
        (s) => !seasons.includes(s.seasonNumber)
      );
      media.status = remaining.some(
        (s) =>
          s.status === MediaStatus.AVAILABLE ||
          s.status === MediaStatus.PARTIALLY_AVAILABLE
      )
        ? MediaStatus.PARTIALLY_AVAILABLE
        : remaining.some((s) => s.status === MediaStatus.PROCESSING)
          ? MediaStatus.PROCESSING
          : MediaStatus.DELETED;
    }
  }

  await mediaRepository.save(media);
  // Their storage use drops now, not when the size cache expires.
  clearStorageCache();
};

/**
 * A user asks to delete their part of a title. One pending request per
 * user and title: asking again updates it.
 */
export const requestDeletion = async (
  user: User,
  media: Media,
  seasons: number[],
  reason?: string
): Promise<DeletionRequest> => {
  const repository = getRepository(DeletionRequest);
  const existing = await repository.findOne({
    where: {
      media: { id: media.id },
      requestedBy: { id: user.id },
      status: DeletionRequestStatus.PENDING,
    },
  });

  return repository.save(
    existing
      ? Object.assign(existing, { seasons, reason: reason ?? existing.reason })
      : new DeletionRequest({
          media,
          requestedBy: user,
          seasons,
          reason: reason ?? null,
          status: DeletionRequestStatus.PENDING,
        })
  );
};

/** An admin approves a deletion request: delete it, and record how it went. */
export const approveDeletion = async (
  request: DeletionRequest,
  admin: User
): Promise<DeletionRequest> => {
  const repository = getRepository(DeletionRequest);
  request.modifiedBy = admin;

  try {
    const media = await getRepository(Media).findOneOrFail({
      where: { id: request.media.id },
    });
    await deleteMedia(media, request.seasons ?? []);
    request.status = DeletionRequestStatus.APPROVED;
  } catch (e) {
    logger.error('Unable to delete media for a deletion request', {
      label: 'Deletion',
      requestId: request.id,
      errorMessage: e.message,
    });
    request.status = DeletionRequestStatus.FAILED;
  }

  return repository.save(request);
};
