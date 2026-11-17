import logger from '@server/logger';
import ServarrBase from './base';

export interface LidarrImage {
  url: string;
  coverType: string;
}

export interface LidarrRating {
  votes: number;
  value: number;
}

export interface LidarrLink {
  url: string;
  name: string;
}

export interface LidarrAlbumOptions {
  [key: string]: unknown;
  title: string;
  disambiguation?: string;
  overview?: string;
  artistId: number;
  foreignAlbumId: string;
  monitored: boolean;
  anyReleaseOk: boolean;
  profileId: number;
  duration?: number;
  albumType: string;
  secondaryTypes: string[];
  mediumCount?: number;
  ratings?: LidarrRating;
  releaseDate?: string;
  releases: unknown[];
  genres: string[];
  media: unknown[];
  artist: {
    status: string;
    ended: boolean;
    artistName: string;
    foreignArtistId: string;
    tadbId?: number;
    discogsId?: number;
    overview?: string;
    artistType: string;
    disambiguation?: string;
    links: LidarrLink[];
    images: LidarrImage[];
    path: string;
    qualityProfileId: number;
    metadataProfileId: number;
    monitored: boolean;
    monitorNewItems: string;
    rootFolderPath: string;
    genres: string[];
    cleanName?: string;
    sortName?: string;
    tags: number[];
    added?: string;
    ratings?: LidarrRating;
    id: number;
  };
  images: LidarrImage[];
  links: LidarrLink[];
  addOptions: {
    searchForNewAlbum: boolean;
  };
}

export interface LidarrAlbum {
  id: number;
  mbId: string;
  title: string;
  monitored: boolean;
  artistId: number;
  foreignAlbumId: string;
  titleSlug: string;
  profileId: number;
  duration: number;
  albumType: string;
  statistics: {
    trackFileCount: number;
    trackCount: number;
    totalTrackCount: number;
    sizeOnDisk: number;
    percentOfTracks: number;
  };
}

export interface MetadataProfile {
  id: number;
  name: string;
}

export interface LidarrImageWithRemote extends LidarrImage {
  remoteUrl?: string;
}

export interface LidarrArtist {
  id?: number;
  artistName: string;
  foreignArtistId: string;
  disambiguation?: string;
  overview?: string;
  artistType?: string;
  status?: string;
  genres: string[];
  images: LidarrImageWithRemote[];
  links: LidarrLink[];
  ratings?: LidarrRating;
  monitored?: boolean;
  monitorNewItems?: string;
  path?: string;
  qualityProfileId?: number;
  metadataProfileId?: number;
  rootFolderPath?: string;
  tags?: number[];
  added?: string;
  statistics?: {
    albumCount: number;
    trackFileCount: number;
    trackCount: number;
    totalTrackCount: number;
    sizeOnDisk: number;
    percentOfTracks: number;
  };
}

/**
 * Which existing albums Lidarr should monitor when an artist is added.
 * Mirrors the "Monitor" dropdown in Lidarr's own Add Artist dialog.
 */
export const LIDARR_MONITOR_OPTIONS = [
  'all',
  'future',
  'missing',
  'existing',
  'latest',
  'first',
  'none',
] as const;

export type LidarrMonitorOption = (typeof LIDARR_MONITOR_OPTIONS)[number];

/**
 * Which albums Lidarr should monitor when they are released in the future.
 */
export const LIDARR_MONITOR_NEW_ITEMS_OPTIONS = ['all', 'none', 'new'] as const;

export type LidarrMonitorNewItemsOption =
  (typeof LIDARR_MONITOR_NEW_ITEMS_OPTIONS)[number];

export interface LidarrAddArtistOptions {
  foreignArtistId: string;
  qualityProfileId: number;
  metadataProfileId: number;
  rootFolderPath: string;
  monitor: LidarrMonitorOption;
  monitorNewItems: LidarrMonitorNewItemsOption;
  tags: number[];
  searchNow: boolean;
}

class LidarrAPI extends ServarrBase<{ albumId: number }> {
  constructor({ url, apiKey }: { url: string; apiKey: string }) {
    super({ url, apiKey, cacheName: 'lidarr', apiName: 'Lidarr' });
  }

  public getAlbums = async (): Promise<LidarrAlbum[]> => {
    try {
      const response = await this.axios.get<LidarrAlbum[]>('/album');

      return response.data;
    } catch (e) {
      throw new Error(`[Lidarr] Failed to retrieve albums: ${e.message}`, {
        cause: e,
      });
    }
  };

  public async getAlbumById(id: number): Promise<LidarrAlbum> {
    try {
      const response = await this.axios.get<LidarrAlbum>(`/album/${id}`);

      return response.data;
    } catch (e) {
      throw new Error(`[Lidarr] Failed to retrieve album by ID: ${e.message}`, {
        cause: e,
      });
    }
  }

  public async getAlbumByForeignAlbumId(mbid: string): Promise<LidarrAlbum> {
    try {
      const response = await this.axios.get<LidarrAlbum[]>('/album/lookup', {
        params: {
          term: `lidarr:${mbid}`,
        },
      });

      if (!response.data[0]) {
        throw new Error('Album not found');
      }

      return response.data[0];
    } catch (e) {
      logger.error('Error retrieving album by MusicBrainz ID', {
        label: 'Lidarr API',
        errorMessage: e.message,
        mbid,
      });
      throw new Error('Album not found', { cause: e });
    }
  }

  public async addAlbum(options: LidarrAlbumOptions): Promise<LidarrAlbum> {
    try {
      const album = await this.getAlbumByForeignAlbumId(options.foreignAlbumId);

      // If the album already exists in Lidarr, just update its monitored flag
      if (album.id) {
        const updatedAlbumResponse = await this.axios.put<LidarrAlbum>(
          `/album/${album.id}`,
          {
            ...album,
            monitored: options.monitored ?? album.monitored,
          }
        );

        if (updatedAlbumResponse.data.id) {
          logger.info('Updated existing album in Lidarr.', {
            label: 'Lidarr',
            albumId: updatedAlbumResponse.data.id,
            albumTitle: updatedAlbumResponse.data.title,
          });
          logger.debug('Lidarr update details', {
            label: 'Lidarr',
            album: updatedAlbumResponse.data,
          });

          if (options.addOptions?.searchForNewAlbum) {
            this.searchAlbum(updatedAlbumResponse.data.id);
          }

          return updatedAlbumResponse.data;
        } else {
          logger.error('Failed to update album in Lidarr', {
            label: 'Lidarr',
            options,
          });
          throw new Error('Failed to update album in Lidarr');
        }
      }

      const createdAlbumResponse = await this.axios.post<LidarrAlbum>(
        '/album',
        {
          ...options,
          monitored: options.monitored ?? true,
        }
      );

      if (createdAlbumResponse.data.id) {
        logger.info('Lidarr accepted request', { label: 'Lidarr' });
        logger.debug('Lidarr add details', {
          label: 'Lidarr',
          album: createdAlbumResponse.data,
        });
      } else {
        logger.error('Failed to add album to Lidarr', {
          label: 'Lidarr',
          options,
        });
        throw new Error('Failed to add album to Lidarr');
      }

      return createdAlbumResponse.data;
    } catch (e) {
      logger.error('Something went wrong while adding an album to Lidarr.', {
        label: 'Lidarr API',
        errorMessage: e.message,
        options,
        response: e?.response?.data,
      });
      throw new Error('Failed to add album', { cause: e });
    }
  }

  public removeAlbum = async (mbid: string): Promise<void> => {
    try {
      const { id, title } = await this.getAlbumByForeignAlbumId(mbid);
      await this.axios.delete(`/album/${id}`, {
        params: {
          deleteFiles: true,
          addImportExclusion: false,
        },
      });
      logger.info(`[Lidarr] Removed album ${title}`);
    } catch (e) {
      throw new Error(`[Lidarr] Failed to remove album: ${e.message}`, {
        cause: e,
      });
    }
  };

  public async searchAlbum(albumId: number): Promise<void> {
    logger.info('Executing album search command.', {
      label: 'Lidarr API',
      albumId,
    });

    try {
      await this.runCommand('AlbumSearch', { albumIds: [albumId] });
    } catch (e) {
      logger.error(
        'Something went wrong while executing Lidarr album search.',
        {
          label: 'Lidarr API',
          errorMessage: e.message,
          albumId,
        }
      );
    }
  }

  public async searchArtists(term: string): Promise<LidarrArtist[]> {
    try {
      const response = await this.axios.get<LidarrArtist[]>('/artist/lookup', {
        params: { term },
      });

      return response.data;
    } catch (e) {
      logger.error('Something went wrong while searching Lidarr for artists.', {
        label: 'Lidarr API',
        errorMessage: e.message,
        term,
      });
      throw new Error('Failed to search artists', { cause: e });
    }
  }

  /**
   * Cached artist lookup used to resolve discovery results (artwork and
   * metadata). Library membership must come from getLibraryArtists, as this
   * may be up to a day old.
   */
  public async lookupArtistsCached(term: string): Promise<LidarrArtist[]> {
    return this.get<LidarrArtist[]>(
      '/artist/lookup',
      { params: { term } },
      86400
    );
  }

  /**
   * Every artist in the Lidarr library, shared by the Music page's rows. A
   * large library is slow to list, so a cached copy is served while a fresh
   * one loads in the background; adds through Seerr clear it right away.
   */
  public async getLibraryArtists(): Promise<LidarrArtist[]> {
    try {
      return await this.getRolling<LidarrArtist[]>('/artist', undefined, 3600);
    } catch (e) {
      throw new Error(`[Lidarr] Failed to retrieve artists: ${e.message}`, {
        cause: e,
      });
    }
  }

  /**
   * The library copy of an album (by MusicBrainz release group id), or
   * undefined when it is not in Lidarr. Cached briefly for the new release
   * rows on the Music page.
   */
  public async getLibraryAlbum(
    foreignAlbumId: string
  ): Promise<LidarrAlbum | undefined> {
    const albums = await this.get<LidarrAlbum[]>(
      '/album',
      { params: { foreignAlbumId } },
      60
    );

    return albums.find((album) => album.foreignAlbumId === foreignAlbumId);
  }

  /**
   * Requests a single album. If the album is already in Lidarr it is
   * monitored and searched for. Otherwise it is added, which also adds its
   * artist (with only this album monitored) when the artist is new.
   */
  public async requestAlbum(options: {
    foreignAlbumId: string;
    qualityProfileId: number;
    metadataProfileId: number;
    rootFolderPath: string;
    tags: number[];
    searchNow: boolean;
  }): Promise<LidarrAlbum> {
    const existing = await this.getLibraryAlbum(options.foreignAlbumId).catch(
      () => undefined
    );

    // The album (and possibly its artist) is about to change in the library.
    this.removeCache('/album', { foreignAlbumId: options.foreignAlbumId });
    this.removeCache('/artist');

    if (existing) {
      const response = await this.axios.put<LidarrAlbum>(
        `/album/${existing.id}`,
        { ...existing, monitored: true }
      );

      if (options.searchNow) {
        await this.searchAlbum(existing.id);
      }

      logger.info('Monitored existing album in Lidarr', {
        label: 'Lidarr',
        albumId: existing.id,
        albumTitle: existing.title,
      });

      return response.data;
    }

    const lookup = await this.axios.get<
      (LidarrAlbum & { artist?: Record<string, unknown> })[]
    >('/album/lookup', {
      params: { term: `lidarr:${options.foreignAlbumId}` },
    });
    const album = lookup.data.find(
      (result) => result.foreignAlbumId === options.foreignAlbumId
    );

    if (!album?.artist) {
      throw new Error('Album not found in Lidarr metadata');
    }

    const response = await this.axios.post<LidarrAlbum>('/album', {
      ...album,
      monitored: true,
      artist: {
        ...album.artist,
        qualityProfileId: options.qualityProfileId,
        metadataProfileId: options.metadataProfileId,
        rootFolderPath: options.rootFolderPath,
        tags: options.tags,
        monitored: true,
        monitorNewItems: 'none',
        addOptions: { monitor: 'none', searchForMissingAlbums: false },
      },
      addOptions: { searchForNewAlbum: options.searchNow },
    });

    logger.info('Lidarr accepted album request', {
      label: 'Lidarr',
      albumId: response.data.id,
      albumTitle: response.data.title,
    });

    return response.data;
  }

  public async getArtistByForeignArtistId(
    foreignArtistId: string
  ): Promise<LidarrArtist> {
    const results = await this.searchArtists(`lidarr:${foreignArtistId}`);
    const artist = results.find(
      (result) => result.foreignArtistId === foreignArtistId
    );

    if (!artist) {
      throw new Error('Artist not found');
    }

    return artist;
  }

  public async addArtist(
    options: LidarrAddArtistOptions
  ): Promise<LidarrArtist> {
    try {
      const artist = await this.getArtistByForeignArtistId(
        options.foreignArtistId
      );

      // Lookup results carry an id only when the artist is already in Lidarr.
      if (artist.id) {
        logger.info('Artist already exists in Lidarr. Skipping add.', {
          label: 'Lidarr',
          artistId: artist.id,
          artistName: artist.artistName,
        });

        return artist;
      }

      const response = await this.axios.post<LidarrArtist>('/artist', {
        ...artist,
        qualityProfileId: options.qualityProfileId,
        metadataProfileId: options.metadataProfileId,
        rootFolderPath: options.rootFolderPath,
        tags: options.tags,
        monitored: options.monitor !== 'none',
        monitorNewItems: options.monitorNewItems,
        addOptions: {
          monitor: options.monitor,
          searchForMissingAlbums: options.searchNow,
        },
      });

      if (!response.data.id) {
        throw new Error('Lidarr did not return an artist id');
      }

      this.removeCache('/artist');

      logger.info('Lidarr accepted request', {
        label: 'Lidarr',
        artistId: response.data.id,
        artistName: response.data.artistName,
      });
      logger.debug('Lidarr add details', {
        label: 'Lidarr',
        artist: response.data,
      });

      return response.data;
    } catch (e) {
      logger.error('Something went wrong while adding an artist to Lidarr.', {
        label: 'Lidarr API',
        errorMessage: e.message,
        options,
        response: e?.response?.data,
      });
      throw new Error('Failed to add artist', { cause: e });
    }
  }

  public async getMetadataProfiles(): Promise<MetadataProfile[]> {
    try {
      const data = await this.getRolling<MetadataProfile[]>(
        '/metadataprofile',
        undefined,
        3600
      );

      return data;
    } catch (e) {
      logger.error(
        'Something went wrong while retrieving Lidarr metadata profiles.',
        {
          label: 'Lidarr API',
          errorMessage: e.message,
        }
      );

      throw new Error('Failed to get metadata profiles', { cause: e });
    }
  }

  public clearCache = ({
    mbId,
    externalId,
    title,
  }: {
    mbId?: string | null;
    externalId?: number | null;
    title?: string | null;
  }) => {
    if (mbId) {
      this.removeCache('/album/lookup', {
        term: `lidarr:${mbId}`,
      });
    }
    if (externalId) {
      this.removeCache(`/album/${externalId}`);
    }
    if (title) {
      this.removeCache('/album/lookup', {
        term: title,
      });
    }
  };
}

export default LidarrAPI;
