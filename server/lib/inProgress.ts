import RadarrAPI, { type RadarrMovie } from '@server/api/servarr/radarr';
import SonarrAPI, { type SonarrSeries } from '@server/api/servarr/sonarr';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { syncMovie, syncSeries } from '@server/lib/arrSync';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { In } from 'typeorm';

/**
 * - downloading / importing: on its way, per the download tracker
 * - searching: released (or aired) and missing, nothing grabbed
 * - unreleased: a movie not out yet (per Radarr's minimum availability)
 * - notSent: Seerr couldn't add it to Radarr/Sonarr, or it's gone from there
 */
export type InProgressPhase =
  | 'downloading'
  | 'importing'
  | 'searching'
  | 'unreleased'
  | 'notSent';

export interface InProgressItem {
  id: number;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  phase: InProgressPhase;
}

/**
 * The *arr's record: the item, null when it doesn't have it (404), or
 * undefined when it couldn't be asked.
 */
type Lookup<T> = T | null | undefined;

interface Common {
  downloading: boolean;
  importing: boolean;
  /** Added to an *arr (has its server and id there) and not failed. */
  sent: boolean;
}

const common = ({
  downloading,
  importing,
  sent,
}: Common): InProgressPhase | undefined | false =>
  downloading
    ? 'downloading'
    : importing
      ? 'importing'
      : !sent
        ? 'notSent'
        : false;

/**
 * Where a requested movie is, by Radarr rather than Seerr's own status,
 * which can say processing long after the movie is in the library. Left
 * out (undefined) once Radarr has the file, or isn't looking for it.
 */
export const classifyMovie = (
  state: Common & {
    movie: Lookup<Pick<RadarrMovie, 'hasFile' | 'monitored' | 'isAvailable'>>;
  }
): InProgressPhase | undefined => {
  const settled = common(state);

  if (settled !== false) {
    return settled;
  }

  const { movie } = state;

  if (movie === null) {
    return 'notSent';
  }

  if (movie === undefined) {
    // Radarr didn't answer: show it rather than hide something stuck.
    return 'searching';
  }

  if (movie.hasFile || !movie.monitored) {
    return undefined;
  }

  return movie.isAvailable ? 'searching' : 'unreleased';
};

/**
 * Where a requested series is, by Sonarr: searching only while a requested
 * season is missing episodes that have aired. A season waiting on new
 * episodes, with everything aired so far in, is left out.
 */
export const classifySeries = (
  state: Common & {
    series: Lookup<Pick<SonarrSeries, 'seasons'>>;
    /** Seasons Seerr has as requested and processing. */
    seasons: number[];
  }
): InProgressPhase | undefined => {
  const settled = common(state);

  if (settled !== false) {
    return settled;
  }

  const { series } = state;

  if (series === null) {
    return 'notSent';
  }

  if (series === undefined) {
    return 'searching';
  }

  const missingAired = state.seasons.some((seasonNumber) => {
    const season = series.seasons.find((s) => s.seasonNumber === seasonNumber);

    // Sonarr's episodeCount: monitored episodes that have aired, plus any
    // with a file.
    return (
      !!season?.monitored &&
      (season.statistics?.episodeFileCount ?? 0) <
        (season.statistics?.episodeCount ?? 0)
    );
  });

  return missingAired ? 'searching' : undefined;
};

/** Asks an *arr, telling "not there" (null) apart from "no answer". */
const lookup = async <T>(ask: () => Promise<T>): Promise<Lookup<T>> => {
  try {
    return await ask();
  } catch (e) {
    if (e.cause?.response?.status === 404) {
      return null;
    }

    logger.debug('Unable to check an item with its *arr', {
      label: 'In Progress',
      errorMessage: e.message,
    });
    return undefined;
  }
};

const PHASE_ORDER: InProgressPhase[] = [
  'downloading',
  'importing',
  'searching',
  'unreleased',
  'notSent',
];

/** A stale status is corrected at most this often per title. */
const RESYNC_MS = 30 * 60 * 1000;
const lastResync = new Map<number, number>();

/**
 * Seerr still has it as processing but the *arr says otherwise: correct it
 * now with the scan logic rather than leave it for the daily scan.
 */
const resyncStale = (mediaId: number, sync: () => Promise<void>): void => {
  const now = Date.now();

  if (now - (lastResync.get(mediaId) ?? 0) < RESYNC_MS) {
    return;
  }

  lastResync.set(mediaId, now);
  sync().catch((e) =>
    logger.debug('Unable to correct a stale status', {
      label: 'In Progress',
      mediaId,
      errorMessage: e.message,
    })
  );
};

/** The page and every user's sidebar poll this; the *arrs needn't feel it. */
const CACHE_MS = 30 * 1000;
let cached: { at: number; result: Promise<InProgressItem[]> } | undefined;

/**
 * Requested movies and series still on their way: approved (or failed to
 * send) and processing in Seerr, then checked with Radarr/Sonarr so items
 * already in the library, or only waiting on unaired episodes, are left
 * out. Downloading first, then importing, searching, unreleased, not sent;
 * most recently changed first within each.
 */
/** For tests: forget the cached list. */
export const clearInProgressCache = (): void => {
  cached = undefined;
};

export const getInProgress = (): Promise<InProgressItem[]> => {
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return cached.result;
  }

  const result = buildInProgress().catch((e) => {
    cached = undefined;
    throw e;
  });
  cached = { at: Date.now(), result };
  return result;
};

const buildInProgress = async (): Promise<InProgressItem[]> => {
  const repository = getRepository(Media);
  const rows: { id: number }[] = await repository
    .createQueryBuilder('media')
    .select('media.id', 'id')
    .distinct(true)
    .leftJoin('media.seasons', 'season')
    .innerJoin(
      'media.requests',
      'request',
      'request.is4k = :is4k AND request.status IN (:...statuses)',
      {
        is4k: false,
        statuses: [MediaRequestStatus.APPROVED, MediaRequestStatus.FAILED],
      }
    )
    .where('(media.status = :processing OR season.status = :processing)', {
      processing: MediaStatus.PROCESSING,
    })
    .getRawMany();

  if (rows.length === 0) {
    return [];
  }

  // find() loads the eager seasons and runs the download tracker hooks.
  const media = await repository.find({
    where: { id: In(rows.map((row) => row.id)) },
    relations: { requests: { seasons: true } },
    order: { updatedAt: 'DESC' },
  });
  const settings = getSettings();

  const items = await Promise.all(
    media.map(async (m): Promise<InProgressItem | undefined> => {
      const failed = (m.requests ?? []).some(
        (r) => !r.is4k && r.status === MediaRequestStatus.FAILED
      );
      const sent =
        !failed &&
        m.serviceId !== null &&
        m.serviceId !== undefined &&
        m.externalServiceId !== null &&
        m.externalServiceId !== undefined;
      const state = {
        downloading: (m.downloadStatus ?? []).length > 0,
        importing: !!m.downloadImporting,
        sent,
      };
      let phase: InProgressPhase | undefined;

      if (m.mediaType === 'movie') {
        const server = settings.radarr.find((s) => s.id === m.serviceId);
        const movie =
          sent && server
            ? await lookup(() =>
                new RadarrAPI({
                  apiKey: server.apiKey,
                  url: RadarrAPI.buildUrl(server, '/api/v3'),
                }).getMovie({ id: m.externalServiceId as number })
              )
            : null;

        phase = classifyMovie({ ...state, movie });

        if (!phase && movie && m.status === MediaStatus.PROCESSING) {
          resyncStale(m.id, () => syncMovie(m.serviceId as number, movie));
        }
      } else if (m.mediaType === 'tv') {
        const server = settings.sonarr.find((s) => s.id === m.serviceId);
        const series =
          sent && server
            ? await lookup(() =>
                new SonarrAPI({
                  apiKey: server.apiKey,
                  url: SonarrAPI.buildUrl(server, '/api/v3'),
                }).getSeriesById(m.externalServiceId as number)
              )
            : null;

        // The seasons on its active requests that aren't in the library.
        const available = new Set(
          m.seasons
            .filter((s) => s.status === MediaStatus.AVAILABLE)
            .map((s) => s.seasonNumber)
        );
        const requested = [
          ...new Set(
            (m.requests ?? [])
              .filter(
                (r) =>
                  !r.is4k &&
                  (r.status === MediaRequestStatus.APPROVED ||
                    r.status === MediaRequestStatus.FAILED)
              )
              .flatMap((r) => (r.seasons ?? []).map((s) => s.seasonNumber))
          ),
        ].filter((n) => n > 0 && !available.has(n));

        phase = classifySeries({
          ...state,
          series,
          seasons: requested.length
            ? requested
            : m.seasons
                .filter((s) => s.status === MediaStatus.PROCESSING)
                .map((s) => s.seasonNumber),
        });

        if (!phase && series) {
          resyncStale(m.id, () => syncSeries(m.serviceId as number, series));
        }
      }

      return phase
        ? {
            id: m.id,
            tmdbId: m.tmdbId,
            mediaType: m.mediaType as InProgressItem['mediaType'],
            phase,
          }
        : undefined;
    })
  );

  return (
    items
      .filter((item): item is InProgressItem => !!item)
      // Stable, so updatedAt order holds within each phase.
      .sort(
        (a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase)
      )
  );
};
