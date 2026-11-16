import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';

export interface LastfmArtist {
  name: string;
  mbid?: string;
  url?: string;
  listeners?: string;
  playcount?: string;
  match?: string;
}

interface LastfmArtistList {
  artist: LastfmArtist[];
  '@attr'?: {
    page?: string;
    totalPages?: string;
  };
}

interface LastfmError {
  error: number;
  message: string;
}

/**
 * Last.fm API client used for music discovery. Last.fm stopped serving artist
 * images, so this only provides names and MusicBrainz ids; artwork comes from
 * Lidarr's metadata lookup.
 */
class LastfmAPI extends ExternalAPI {
  constructor(apiKey: string) {
    super(
      'https://ws.audioscrobbler.com/2.0/',
      { api_key: apiKey, format: 'json' },
      {
        nodeCache: cacheManager.getCache('lastfm').data,
        timeout: 15000,
      }
    );
  }

  private async call<T extends object>(
    method: string,
    params: Record<string, string | number>,
    ttl?: number
  ): Promise<T> {
    const data = await this.get<T | LastfmError>(
      '',
      { params: { method, ...params } },
      ttl
    );

    if ('error' in data) {
      throw new Error(`[Last.fm] ${data.message}`);
    }

    return data;
  }

  /** Validates the API key. Never cached, so a changed key is always tested. */
  public async testApiKey(): Promise<void> {
    await this.call('chart.gettoptags', { limit: 1 }, 0);
  }

  public async getTopArtists({
    page = 1,
    limit = 20,
  }: { page?: number; limit?: number } = {}): Promise<LastfmArtist[]> {
    const data = await this.call<{ artists: LastfmArtistList }>(
      'chart.gettopartists',
      { page, limit }
    );

    return data.artists?.artist ?? [];
  }

  public async getTopArtistsByTag({
    tag,
    page = 1,
    limit = 20,
  }: {
    tag: string;
    page?: number;
    limit?: number;
  }): Promise<LastfmArtist[]> {
    const data = await this.call<{ topartists: LastfmArtistList }>(
      'tag.gettopartists',
      { tag, page, limit }
    );

    return data.topartists?.artist ?? [];
  }

  public async getSimilarArtists({
    mbid,
    name,
    limit = 20,
  }: {
    mbid?: string;
    name?: string;
    limit?: number;
  }): Promise<LastfmArtist[]> {
    const data = await this.call<{ similarartists: LastfmArtistList }>(
      'artist.getsimilar',
      {
        ...(mbid ? { mbid } : { artist: name ?? '' }),
        autocorrect: 1,
        limit,
      },
      // Similar artists rarely change; keep them for a day.
      86400
    );

    return data.similarartists?.artist ?? [];
  }
}

export default LastfmAPI;
