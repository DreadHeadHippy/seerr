import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';

export interface FreshRelease {
  releaseGroupMbid: string;
  title: string;
  type: string;
  artistName: string;
  artistMbids: string[];
  releaseDate: string;
  coverUrl?: string;
}

interface ListenbrainzFreshRelease {
  artist_credit_name?: string;
  artist_mbids?: string[];
  caa_id?: number;
  caa_release_mbid?: string;
  release_date?: string;
  release_group_mbid?: string;
  release_group_primary_type?: string;
  release_name?: string;
}

interface FreshReleasesResponse {
  payload?: { releases?: ListenbrainzFreshRelease[] };
}

const RELEASE_TYPES = new Set(['Album', 'EP', 'Single']);

/**
 * ListenBrainz's public API (no key required). Provides the MusicBrainz
 * releases that came out recently, used for the "new release" rows.
 */
class ListenbrainzAPI extends ExternalAPI {
  constructor() {
    super(
      'https://api.listenbrainz.org/1',
      {},
      {
        nodeCache: cacheManager.getCache('listenbrainz').data,
        timeout: 30000,
      }
    );
  }

  /**
   * Releases from the last `days` days, newest first. The feed is fetched for
   * 30 days and cached for six hours, then filtered locally.
   */
  public async getFreshReleases(days: number): Promise<FreshRelease[]> {
    const data = await this.get<FreshReleasesResponse>(
      '/explore/fresh-releases/',
      { params: { days: 30, past: 'true', future: 'false' } },
      21600
    );

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffDay = cutoff.toISOString().slice(0, 10);

    return (data.payload?.releases ?? [])
      .flatMap((release): FreshRelease[] => {
        const type = release.release_group_primary_type ?? '';

        if (
          !release.release_group_mbid ||
          !release.release_name ||
          !release.release_date ||
          !RELEASE_TYPES.has(type) ||
          release.release_date < cutoffDay
        ) {
          return [];
        }

        return [
          {
            releaseGroupMbid: release.release_group_mbid,
            title: release.release_name,
            type,
            artistName: release.artist_credit_name ?? '',
            artistMbids: (release.artist_mbids ?? []).filter(Boolean),
            releaseDate: release.release_date,
            coverUrl:
              release.caa_id && release.caa_release_mbid
                ? `https://coverartarchive.org/release/${release.caa_release_mbid}/${release.caa_id}-500.jpg`
                : undefined,
          },
        ];
      })
      .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  }
}

export default ListenbrainzAPI;
