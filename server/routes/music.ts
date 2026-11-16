import LastfmAPI from '@server/api/lastfm';
import ListenbrainzAPI from '@server/api/listenbrainz';
import LidarrAPI, {
  LIDARR_MONITOR_NEW_ITEMS_OPTIONS,
  LIDARR_MONITOR_OPTIONS,
} from '@server/api/servarr/lidarr';
import type {
  MusicAlbumAddBody,
  MusicAlbumResult,
  MusicArtistAddBody,
  MusicArtistResult,
  MusicPersonalResponse,
  MusicSearchResponse,
} from '@server/interfaces/api/musicInterfaces';
import type { DiscoveryContext } from '@server/lib/music';
import {
  MUSIC_SLIDER_SIZE,
  createDiscoveryContext,
  createLidarrClient,
  fillMissingArtwork,
  getDefaultLidarr,
  getLibraryGenres,
  getNewFromLibraryArtists,
  getNewThisWeek,
  getPersonalSeeds,
  getRecentlyAddedArtists,
  getSimilarToArtist,
  getSimilarToLibraryArtists,
  mapArtist,
  resolveLastfmArtists,
} from '@server/lib/music';
import { Permission } from '@server/lib/permissions';
import type { LidarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { sanitizeDisplayName } from '@server/subscriber/MediaRequestSubscriber';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

const musicRoutes = Router();

type DiscoverSource = (
  context: DiscoveryContext,
  lastfm: LastfmAPI | undefined,
  req: Request
) => Promise<unknown> | unknown;

/**
 * Shared handler for the Music page rows. Every row needs Lidarr (for artwork
 * and library status); rows that use Last.fm also need its key.
 */
const discoverHandler =
  (source: DiscoverSource, requiresLastfm: boolean) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const lidarrSettings = getDefaultLidarr();

    if (!lidarrSettings) {
      return next({ status: 404, message: 'No Lidarr server is configured.' });
    }

    const lastfmKey = getSettings().lastfm?.apiKey;

    if (requiresLastfm && !lastfmKey) {
      return next({
        status: 404,
        message: 'No Last.fm API key is configured.',
      });
    }

    try {
      const context = await createDiscoveryContext(
        lidarrSettings,
        !!req.user?.hasPermission(Permission.MANAGE_REQUESTS)
      );

      return res
        .status(200)
        .json(
          await source(
            context,
            lastfmKey ? new LastfmAPI(lastfmKey) : undefined,
            req
          )
        );
    } catch (e) {
      logger.error('Failed to load music discovery results', {
        label: 'Music Discovery',
        path: req.path,
        errorMessage: e.message,
      });

      return next({
        status: 500,
        message: 'Unable to load music recommendations.',
      });
    }
  };

/** Wraps an artist row: fills in missing artwork and returns `{ results }`. */
const artistRow =
  (
    source: (
      context: DiscoveryContext,
      lastfm: LastfmAPI,
      req: Request
    ) => Promise<MusicArtistResult[]> | MusicArtistResult[]
  ): DiscoverSource =>
  async (context, lastfm, req) =>
    ({
      results: await fillMissingArtwork(
        await source(context, lastfm as LastfmAPI, req)
      ),
    }) as MusicSearchResponse;

musicRoutes.get(
  '/discover/recent',
  discoverHandler(
    artistRow((context) => getRecentlyAddedArtists(context)),
    false
  )
);

musicRoutes.get(
  '/discover/similar',
  discoverHandler(
    artistRow((context, lastfm) => getSimilarToLibraryArtists(context, lastfm)),
    true
  )
);

musicRoutes.get(
  '/discover/similar/:foreignArtistId',
  discoverHandler(
    artistRow((context, lastfm, req) =>
      getSimilarToArtist(context, lastfm, String(req.params.foreignArtistId))
    ),
    true
  )
);

musicRoutes.get(
  '/discover/top',
  discoverHandler(
    artistRow(async (context, lastfm) =>
      resolveLastfmArtists(
        context,
        await lastfm.getTopArtists({ limit: MUSIC_SLIDER_SIZE })
      )
    ),
    true
  )
);

musicRoutes.get(
  '/discover/genre/:genre',
  discoverHandler(
    artistRow(async (context, lastfm, req) =>
      resolveLastfmArtists(
        context,
        await lastfm.getTopArtistsByTag({
          tag: String(req.params.genre),
          limit: MUSIC_SLIDER_SIZE,
        })
      )
    ),
    true
  )
);

musicRoutes.get(
  '/discover/personal',
  discoverHandler(
    (context): MusicPersonalResponse => ({
      seeds: getPersonalSeeds(context),
      genres: getLibraryGenres(context),
    }),
    false
  )
);

musicRoutes.get(
  '/discover/new-from-library',
  discoverHandler(
    async (context) => ({
      results: await getNewFromLibraryArtists(context, new ListenbrainzAPI()),
    }),
    false
  )
);

musicRoutes.get(
  '/discover/new-this-week',
  discoverHandler(
    async (context, lastfm) => ({
      results: await getNewThisWeek(
        context,
        lastfm as LastfmAPI,
        new ListenbrainzAPI()
      ),
    }),
    true
  )
);

musicRoutes.get<never, MusicSearchResponse, never, { query?: string }>(
  '/search',
  async (req, res, next) => {
    const query = (req.query.query ?? '').toString().trim();

    if (!query) {
      return res.status(200).json({ results: [] });
    }

    const lidarrSettings = getDefaultLidarr();

    if (!lidarrSettings) {
      return next({
        status: 404,
        message: 'No Lidarr server is configured.',
      });
    }

    const lidarr = createLidarrClient(lidarrSettings);

    try {
      const artists = await lidarr.searchArtists(query);
      const showLidarrUrl = !!req.user?.hasPermission(
        Permission.MANAGE_REQUESTS
      );

      return res.status(200).json({
        results: await fillMissingArtwork(
          artists.map((artist) =>
            mapArtist(artist, lidarrSettings, showLidarrUrl)
          )
        ),
      });
    } catch (e) {
      logger.error('Failed to search Lidarr for artists', {
        label: 'API',
        errorMessage: e.message,
        query,
      });

      return next({
        status: 500,
        message: 'Unable to search Lidarr for artists.',
      });
    }
  }
);

interface RequestOverrides {
  serverId?: number;
  profileId?: number;
  metadataProfileId?: number;
  rootFolder?: string;
  tags?: number[];
}

/**
 * Shared setup for artist and album requests: checks the Request Music
 * permission, picks the Lidarr server and profiles (overrides are only
 * honored for users with advanced request or manage request permissions,
 * the same rule as movie and series requests) and adds the requester's tag
 * when the server has Tag Requests enabled.
 */
const prepareLidarrRequest = async (
  req: Request,
  overrides: RequestOverrides
): Promise<
  | { error: { status: number; message: string } }
  | {
      lidarrSettings: LidarrSettings;
      lidarr: ReturnType<typeof createLidarrClient>;
      qualityProfileId: number;
      metadataProfileId: number;
      rootFolderPath: string;
      tags: number[];
      searchNow: boolean;
    }
> => {
  const user = req.user;

  if (
    !user?.hasPermission([Permission.REQUEST, Permission.REQUEST_MUSIC], {
      type: 'or',
    })
  ) {
    return {
      error: {
        status: 403,
        message: 'You do not have permission to request music.',
      },
    };
  }

  const canOverride = user.hasPermission(
    [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
    { type: 'or' }
  );
  const lidarrSettings =
    canOverride && overrides.serverId !== undefined
      ? getSettings().lidarr.find((server) => server.id === overrides.serverId)
      : getDefaultLidarr();

  if (!lidarrSettings) {
    return {
      error: { status: 404, message: 'No Lidarr server is configured.' },
    };
  }

  const lidarr = createLidarrClient(lidarrSettings);
  const tags = [
    ...((canOverride ? overrides.tags : undefined) ??
      lidarrSettings.tags ??
      []),
  ];

  if (lidarrSettings.tagRequests) {
    const lidarrTags = await lidarr.getTags();
    const label = `${user.id}-${sanitizeDisplayName(user.displayName)}`;
    let userTag =
      lidarrTags.find((tag) => tag.label.startsWith(`${user.id} - `)) ??
      lidarrTags.find((tag) => tag.label.startsWith(`${user.id}-`));

    if (!userTag) {
      logger.info('Requester has no active tag. Creating new', {
        label: 'Lidarr',
        userId: user.id,
        newTag: label,
      });
      userTag = await lidarr.createTag({ label });
    }

    if (userTag.id && !tags.includes(userTag.id)) {
      tags.push(userTag.id);
    }
  }

  return {
    lidarrSettings,
    lidarr,
    qualityProfileId:
      (canOverride ? overrides.profileId : undefined) ??
      lidarrSettings.activeProfileId,
    metadataProfileId:
      (canOverride ? overrides.metadataProfileId : undefined) ??
      lidarrSettings.activeMetadataProfileId,
    rootFolderPath:
      (canOverride ? overrides.rootFolder : undefined) ??
      lidarrSettings.activeDirectory,
    tags,
    searchNow: !lidarrSettings.preventSearch,
  };
};

musicRoutes.post<never, MusicArtistResult, MusicArtistAddBody>(
  '/artist',
  async (req, res, next) => {
    const {
      foreignArtistId,
      monitor = 'all',
      monitorNewItems = 'all',
    } = req.body;

    if (!foreignArtistId || typeof foreignArtistId !== 'string') {
      return next({ status: 400, message: 'foreignArtistId is required.' });
    }

    if (
      !LIDARR_MONITOR_OPTIONS.includes(monitor) ||
      !LIDARR_MONITOR_NEW_ITEMS_OPTIONS.includes(monitorNewItems)
    ) {
      return next({ status: 400, message: 'Invalid monitor option.' });
    }

    try {
      const prepared = await prepareLidarrRequest(req, req.body);

      if ('error' in prepared) {
        return next(prepared.error);
      }

      const { lidarr, lidarrSettings, ...options } = prepared;
      const artist = await lidarr.addArtist({
        ...options,
        foreignArtistId,
        monitor,
        monitorNewItems,
      });

      logger.info('Artist added to Lidarr', {
        label: 'Lidarr',
        userId: req.user?.id,
        artistName: artist.artistName,
        foreignArtistId,
        monitor,
      });

      return res
        .status(201)
        .json(
          mapArtist(
            artist,
            lidarrSettings,
            !!req.user?.hasPermission(Permission.MANAGE_REQUESTS)
          )
        );
    } catch (e) {
      logger.error('Failed to add artist to Lidarr', {
        label: 'API',
        errorMessage: e.message,
        foreignArtistId,
      });

      return next({
        status: 500,
        message: 'Unable to add artist to Lidarr.',
      });
    }
  }
);

musicRoutes.post<never, Partial<MusicAlbumResult>, MusicAlbumAddBody>(
  '/album',
  async (req, res, next) => {
    const { foreignAlbumId } = req.body;

    if (!foreignAlbumId || typeof foreignAlbumId !== 'string') {
      return next({ status: 400, message: 'foreignAlbumId is required.' });
    }

    try {
      const prepared = await prepareLidarrRequest(req, req.body);

      if ('error' in prepared) {
        return next(prepared.error);
      }

      const { lidarr, lidarrSettings, ...options } = prepared;
      const album = await lidarr.requestAlbum({ ...options, foreignAlbumId });
      const lidarrUrl = req.user?.hasPermission(Permission.MANAGE_REQUESTS)
        ? `${(
            lidarrSettings.externalUrl || LidarrAPI.buildUrl(lidarrSettings)
          ).replace(/\/$/, '')}/album/${foreignAlbumId}`
        : undefined;

      logger.info('Album requested in Lidarr', {
        label: 'Lidarr',
        userId: req.user?.id,
        albumTitle: album.title,
        foreignAlbumId,
      });

      return res.status(201).json({
        foreignAlbumId,
        title: album.title,
        inLidarr: true,
        monitored: true,
        hasFiles: (album.statistics?.trackFileCount ?? 0) > 0,
        lidarrUrl,
      });
    } catch (e) {
      logger.error('Failed to request album in Lidarr', {
        label: 'API',
        errorMessage: e.message,
        foreignAlbumId,
      });

      return next({
        status: 500,
        message:
          e.message === 'Album not found in Lidarr metadata'
            ? "Lidarr doesn't know this release yet. Try again in a day or two."
            : 'Unable to request album in Lidarr.',
      });
    }
  }
);

export default musicRoutes;
