import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';

export interface MusicBrainzReleaseGroup {
  id: string;
  title: string;
  'primary-type'?: string | null;
  'secondary-types'?: string[];
  'first-release-date'?: string;
  disambiguation?: string;
}

interface ReleaseGroupBrowse {
  'release-group-count': number;
  'release-group-offset': number;
  'release-groups': MusicBrainzReleaseGroup[];
}

/** MusicBrainz caps a browse page at 100 results. */
const PAGE_SIZE = 100;

/** Enough for any real discography while bounding slow, 1 rps paging. */
const MAX_RELEASE_GROUPS = 400;

/**
 * MusicBrainz web service (no key required). Used for an artist's complete
 * discography, which Lidarr only has for albums it already tracks.
 */
class MusicBrainzAPI extends ExternalAPI {
  constructor() {
    super(
      'https://musicbrainz.org/ws/2',
      { fmt: 'json' },
      {
        nodeCache: cacheManager.getCache('musicbrainz').data,
        timeout: 15000,
        // MusicBrainz allows one request per second per client.
        rateLimit: { maxRPS: 1, maxRequests: 1 },
      }
    );
  }

  /**
   * The artist's official release groups (albums, EPs, singles, live,
   * compilations, ...), leaving out bootleg-only ones as musicbrainz.org does.
   */
  public async getReleaseGroups(
    artistMbid: string
  ): Promise<MusicBrainzReleaseGroup[]> {
    const groups: MusicBrainzReleaseGroup[] = [];
    let total = Infinity;

    while (groups.length < Math.min(total, MAX_RELEASE_GROUPS)) {
      const page = await this.get<ReleaseGroupBrowse>(
        '/release-group',
        {
          params: {
            artist: artistMbid,
            'release-group-status': 'website-default',
            limit: PAGE_SIZE,
            offset: groups.length,
          },
        },
        // Discographies change rarely; keep them for a day.
        86400
      );

      const results = page['release-groups'] ?? [];
      total = page['release-group-count'] ?? 0;
      groups.push(...results);

      if (results.length === 0) {
        break;
      }
    }

    return groups;
  }
}

let sharedInstance: MusicBrainzAPI | undefined;

/** One client for the whole server, so every caller shares the 1 rps limit. */
export const getMusicBrainz = (): MusicBrainzAPI => {
  sharedInstance ??= new MusicBrainzAPI();
  return sharedInstance;
};

export default MusicBrainzAPI;
