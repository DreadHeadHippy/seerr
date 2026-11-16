import LastfmAPI from '@server/api/lastfm';
import {
  LIDARR_MONITOR_NEW_ITEMS_OPTIONS,
  LIDARR_MONITOR_OPTIONS,
} from '@server/api/servarr/lidarr';
import type {
  MusicArtistAddBody,
  MusicArtistResult,
  MusicSearchResponse,
} from '@server/interfaces/api/musicInterfaces';
import {
  MUSIC_SLIDER_SIZE,
  createDiscoveryContext,
  createLidarrClient,
  fillMissingArtwork,
  getDefaultLidarr,
  getRecentlyAddedArtists,
  getSimilarToLibraryArtists,
  mapArtist,
  resolveLastfmArtists,
} from '@server/lib/music';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { sanitizeDisplayName } from '@server/subscriber/MediaRequestSubscriber';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

const musicRoutes = Router();

type DiscoverSource = (
  context: Awaited<ReturnType<typeof createDiscoveryContext>>,
  lastfm: LastfmAPI | undefined,
  req: Request
) => Promise<MusicArtistResult[]> | MusicArtistResult[];

/**
 * Shared handler for the Music page sliders. Every slider needs Lidarr (for
 * artwork and library status); sources that use Last.fm also need its key.
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
      const results = await source(
        context,
        lastfmKey ? new LastfmAPI(lastfmKey) : undefined,
        req
      );

      return res
        .status(200)
        .json({ results: await fillMissingArtwork(results) });
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

musicRoutes.get(
  '/discover/recent',
  discoverHandler((context) => getRecentlyAddedArtists(context), false)
);

musicRoutes.get(
  '/discover/similar',
  discoverHandler(
    (context, lastfm) =>
      getSimilarToLibraryArtists(context, lastfm as LastfmAPI),
    true
  )
);

musicRoutes.get(
  '/discover/top',
  discoverHandler(async (context, lastfm) => {
    const artists = await (lastfm as LastfmAPI).getTopArtists({
      limit: MUSIC_SLIDER_SIZE,
    });

    return resolveLastfmArtists(context, artists);
  }, true)
);

musicRoutes.get(
  '/discover/genre/:genre',
  discoverHandler(async (context, lastfm, req) => {
    const artists = await (lastfm as LastfmAPI).getTopArtistsByTag({
      tag: String(req.params.genre),
      limit: MUSIC_SLIDER_SIZE,
    });

    return resolveLastfmArtists(context, artists);
  }, true)
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

musicRoutes.post<never, MusicArtistResult, MusicArtistAddBody>(
  '/artist',
  async (req, res, next) => {
    if (
      !req.user?.hasPermission([Permission.REQUEST, Permission.REQUEST_MUSIC], {
        type: 'or',
      })
    ) {
      return next({
        status: 403,
        message: 'You do not have permission to request music.',
      });
    }

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

    // Same rule as movie and series requests: only users with advanced
    // request or manage request permissions may override server defaults.
    const canOverride = req.user.hasPermission(
      [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
      { type: 'or' }
    );

    const settings = getSettings();
    const lidarrSettings =
      canOverride && req.body.serverId !== undefined
        ? settings.lidarr.find((server) => server.id === req.body.serverId)
        : getDefaultLidarr();

    if (!lidarrSettings) {
      return next({
        status: 404,
        message: 'No Lidarr server is configured.',
      });
    }

    const lidarr = createLidarrClient(lidarrSettings);

    try {
      const tags = [
        ...((canOverride ? req.body.tags : undefined) ??
          lidarrSettings.tags ??
          []),
      ];

      if (lidarrSettings.tagRequests) {
        const lidarrTags = await lidarr.getTags();
        const label = `${req.user.id}-${sanitizeDisplayName(
          req.user.displayName
        )}`;
        let userTag =
          lidarrTags.find((tag) =>
            tag.label.startsWith(`${req.user?.id} - `)
          ) ??
          lidarrTags.find((tag) => tag.label.startsWith(`${req.user?.id}-`));

        if (!userTag) {
          logger.info('Requester has no active tag. Creating new', {
            label: 'Lidarr',
            userId: req.user.id,
            newTag: label,
          });
          userTag = await lidarr.createTag({ label });
        }

        if (userTag.id && !tags.includes(userTag.id)) {
          tags.push(userTag.id);
        }
      }

      const artist = await lidarr.addArtist({
        foreignArtistId,
        qualityProfileId:
          (canOverride ? req.body.profileId : undefined) ??
          lidarrSettings.activeProfileId,
        metadataProfileId:
          (canOverride ? req.body.metadataProfileId : undefined) ??
          lidarrSettings.activeMetadataProfileId,
        rootFolderPath:
          (canOverride ? req.body.rootFolder : undefined) ??
          lidarrSettings.activeDirectory,
        monitor,
        monitorNewItems,
        tags,
        searchNow: !lidarrSettings.preventSearch,
      });

      logger.info('Artist added to Lidarr', {
        label: 'Lidarr',
        userId: req.user.id,
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
            req.user.hasPermission(Permission.MANAGE_REQUESTS)
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

export default musicRoutes;
