import type {
  LidarrArtist,
  LidarrImageWithRemote,
} from '@server/api/servarr/lidarr';
import LidarrAPI, {
  LIDARR_MONITOR_NEW_ITEMS_OPTIONS,
  LIDARR_MONITOR_OPTIONS,
} from '@server/api/servarr/lidarr';
import type {
  MusicArtistAddBody,
  MusicArtistResult,
  MusicSearchResponse,
} from '@server/interfaces/api/musicInterfaces';
import { Permission } from '@server/lib/permissions';
import type { LidarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { sanitizeDisplayName } from '@server/subscriber/MediaRequestSubscriber';
import { Router } from 'express';

const musicRoutes = Router();

const getDefaultLidarr = (): LidarrSettings | undefined => {
  const { lidarr } = getSettings();

  return lidarr.find((server) => server.isDefault) ?? lidarr[0];
};

const getImageUrl = (
  images: LidarrImageWithRemote[],
  coverType: string
): string | undefined => {
  const image = images.find((i) => i.coverType === coverType);

  if (!image) {
    return undefined;
  }

  if (image.remoteUrl) {
    return image.remoteUrl;
  }

  // Lookup results for artists not yet in Lidarr only carry an absolute url.
  return image.url?.startsWith('http') ? image.url : undefined;
};

const mapArtist = (
  artist: LidarrArtist,
  lidarrSettings: LidarrSettings,
  showLidarrUrl: boolean
): MusicArtistResult => ({
  foreignArtistId: artist.foreignArtistId,
  artistName: artist.artistName,
  disambiguation: artist.disambiguation || undefined,
  overview: artist.overview,
  artistType: artist.artistType,
  genres: artist.genres ?? [],
  posterUrl: getImageUrl(artist.images ?? [], 'poster'),
  fanartUrl: getImageUrl(artist.images ?? [], 'fanart'),
  inLidarr: !!artist.id,
  monitored: !!artist.id && !!artist.monitored,
  albumCount: artist.statistics?.albumCount,
  trackFileCount: artist.statistics?.trackFileCount,
  lidarrUrl:
    showLidarrUrl && artist.id
      ? `${(
          lidarrSettings.externalUrl || LidarrAPI.buildUrl(lidarrSettings)
        ).replace(/\/$/, '')}/artist/${artist.foreignArtistId}`
      : undefined,
});

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

    const lidarr = new LidarrAPI({
      apiKey: lidarrSettings.apiKey,
      url: LidarrAPI.buildUrl(lidarrSettings, '/api/v1'),
    });

    try {
      const artists = await lidarr.searchArtists(query);
      const showLidarrUrl = !!req.user?.hasPermission(
        Permission.MANAGE_REQUESTS
      );

      return res.status(200).json({
        results: artists.map((artist) =>
          mapArtist(artist, lidarrSettings, showLidarrUrl)
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

    const lidarr = new LidarrAPI({
      apiKey: lidarrSettings.apiKey,
      url: LidarrAPI.buildUrl(lidarrSettings, '/api/v1'),
    });

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
