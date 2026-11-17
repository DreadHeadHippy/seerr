import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';

interface DeezerArtist {
  id: number;
  name: string;
  nb_fan?: number;
  picture_big?: string;
}

interface DeezerSearchResponse {
  data?: DeezerArtist[];
}

interface DeezerTrack {
  id: number;
  title: string;
  title_short?: string;
  duration?: number;
  preview?: string;
  readable?: boolean;
  album?: { title?: string; cover_medium?: string };
}

interface DeezerTrackList {
  data?: DeezerTrack[];
}

export interface DeezerPreviewTrack {
  id: number;
  title: string;
  albumTitle?: string;
  coverUrl?: string;
  previewUrl: string;
}

const normalizeName = (name: string): string =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Deezer's public API (no key required). Used only as a fallback source of
 * artist photos when Lidarr's metadata has no poster for an artist.
 */
class DeezerAPI extends ExternalAPI {
  constructor() {
    super(
      'https://api.deezer.com',
      {},
      {
        nodeCache: cacheManager.getCache('deezer').data,
        timeout: 10000,
        // Deezer allows 50 requests per 5 seconds.
        rateLimit: { maxRPS: 8, maxRequests: 8 },
      }
    );
  }

  /**
   * The Deezer artist with exactly this name, picking the most followed one
   * when several artists share the name.
   */
  private async findArtist(name: string): Promise<DeezerArtist | undefined> {
    const response = await this.get<DeezerSearchResponse>(
      '/search/artist',
      { params: { q: name, limit: 10 } },
      // Artist search results rarely change; keep them for a week.
      604800
    );

    const target = normalizeName(name);

    return (response.data ?? [])
      .filter((artist) => normalizeName(artist.name) === target)
      .sort((a, b) => (b.nb_fan ?? 0) - (a.nb_fan ?? 0))[0];
  }

  /**
   * Returns a photo for the artist with exactly this name. Returns undefined
   * when there is no exact match or Deezer has no photo.
   */
  public async getArtistImage(name: string): Promise<string | undefined> {
    const match = await this.findArtist(name);

    // Deezer's placeholder for artists without a photo has an empty hash.
    if (!match?.picture_big || match.picture_big.includes('/artist//')) {
      return undefined;
    }

    return match.picture_big;
  }

  /**
   * The artist's most popular tracks that have a 30 second preview clip.
   * Preview urls are signed and expire, so the list is only cached briefly.
   */
  public async getTopTracks(
    name: string,
    limit = 10
  ): Promise<DeezerPreviewTrack[]> {
    const artist = await this.findArtist(name);

    if (!artist) {
      return [];
    }

    const response = await this.get<DeezerTrackList>(
      `/artist/${artist.id}/top`,
      { params: { limit } },
      // Preview links expire 15 minutes after they are issued; leave time
      // for a full queue of 30 second clips to play.
      300
    );

    return (response.data ?? [])
      .filter((track) => track.preview && track.readable !== false)
      .map((track) => ({
        id: track.id,
        title: track.title_short || track.title,
        albumTitle: track.album?.title,
        coverUrl: track.album?.cover_medium,
        previewUrl: track.preview as string,
      }));
  }
}

export default DeezerAPI;
