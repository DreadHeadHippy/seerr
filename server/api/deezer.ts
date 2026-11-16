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
   * Returns a photo for the artist with exactly this name, picking the most
   * followed one when several artists share the name. Returns undefined when
   * there is no exact match or Deezer has no photo.
   */
  public async getArtistImage(name: string): Promise<string | undefined> {
    const response = await this.get<DeezerSearchResponse>(
      '/search/artist',
      { params: { q: name, limit: 10 } },
      // Artist photos rarely change; keep them for a week.
      604800
    );

    const target = normalizeName(name);
    const match = (response.data ?? [])
      .filter((artist) => normalizeName(artist.name) === target)
      .sort((a, b) => (b.nb_fan ?? 0) - (a.nb_fan ?? 0))[0];

    // Deezer's placeholder for artists without a photo has an empty hash.
    if (!match?.picture_big || match.picture_big.includes('/artist//')) {
      return undefined;
    }

    return match.picture_big;
  }
}

export default DeezerAPI;
