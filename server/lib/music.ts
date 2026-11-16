import DeezerAPI from '@server/api/deezer';
import type LastfmAPI from '@server/api/lastfm';
import type { LastfmArtist } from '@server/api/lastfm';
import type {
  LidarrArtist,
  LidarrImageWithRemote,
} from '@server/api/servarr/lidarr';
import LidarrAPI from '@server/api/servarr/lidarr';
import type { MusicArtistResult } from '@server/interfaces/api/musicInterfaces';
import type { LidarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

/** Number of artists shown in each Music page slider. */
export const MUSIC_SLIDER_SIZE = 20;

/** Lidarr lookups run in parallel, but no more than this many at once. */
const LOOKUP_CONCURRENCY = 5;

/** How many recently added library artists seed "Similar to your library". */
const SIMILAR_SEED_COUNT = 12;

export const getDefaultLidarr = (): LidarrSettings | undefined => {
  const { lidarr } = getSettings();

  return lidarr.find((server) => server.isDefault) ?? lidarr[0];
};

export const createLidarrClient = (settings: LidarrSettings): LidarrAPI =>
  new LidarrAPI({
    apiKey: settings.apiKey,
    url: LidarrAPI.buildUrl(settings, '/api/v1'),
  });

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

export const mapArtist = (
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

const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );

  return results;
};

/**
 * Lidarr's metadata has no poster for some artists. Fill those in from Deezer,
 * falling back to Lidarr's fanart, so cards are not left blank.
 */
export const fillMissingArtwork = async (
  results: MusicArtistResult[]
): Promise<MusicArtistResult[]> => {
  const deezer = new DeezerAPI();

  return mapWithConcurrency(results, LOOKUP_CONCURRENCY, async (artist) => {
    if (artist.posterUrl) {
      return artist;
    }

    let posterUrl: string | undefined;

    try {
      posterUrl = await deezer.getArtistImage(artist.artistName);
    } catch (e) {
      logger.debug('Unable to get artist image from Deezer', {
        label: 'Music Discovery',
        artist: artist.artistName,
        errorMessage: e.message,
      });
    }

    return { ...artist, posterUrl: posterUrl ?? artist.fanartUrl };
  });
};

interface DiscoveryContext {
  lidarr: LidarrAPI;
  lidarrSettings: LidarrSettings;
  library: Map<string, LidarrArtist>;
  showLidarrUrl: boolean;
}

export const createDiscoveryContext = async (
  lidarrSettings: LidarrSettings,
  showLidarrUrl: boolean
): Promise<DiscoveryContext> => {
  const lidarr = createLidarrClient(lidarrSettings);
  const libraryArtists = await lidarr.getLibraryArtists();

  return {
    lidarr,
    lidarrSettings,
    library: new Map(
      libraryArtists.map((artist) => [artist.foreignArtistId, artist])
    ),
    showLidarrUrl,
  };
};

/**
 * Turns Last.fm artists into Music page results. Each artist is matched to
 * Lidarr's metadata by MusicBrainz id (or by exact name when Last.fm has no
 * id), which also guarantees it can be added to Lidarr. Artists that cannot be
 * matched are dropped.
 */
export const resolveLastfmArtists = async (
  context: DiscoveryContext,
  artists: LastfmArtist[]
): Promise<MusicArtistResult[]> => {
  const resolved = await mapWithConcurrency(
    artists,
    LOOKUP_CONCURRENCY,
    async (artist): Promise<LidarrArtist | undefined> => {
      if (artist.mbid && context.library.has(artist.mbid)) {
        return context.library.get(artist.mbid);
      }

      try {
        const results = await context.lidarr.lookupArtistsCached(
          artist.mbid ? `lidarr:${artist.mbid}` : artist.name
        );
        const match = artist.mbid
          ? results.find((r) => r.foreignArtistId === artist.mbid)
          : results.find(
              (r) =>
                r.artistName.localeCompare(artist.name, undefined, {
                  sensitivity: 'base',
                }) === 0
            );

        if (!match) {
          return undefined;
        }

        return (
          context.library.get(match.foreignArtistId) ?? {
            ...match,
            id: undefined,
          }
        );
      } catch (e) {
        logger.debug('Unable to match Last.fm artist in Lidarr', {
          label: 'Music Discovery',
          artist: artist.name,
          errorMessage: e.message,
        });
        return undefined;
      }
    }
  );

  const seen = new Set<string>();

  return resolved
    .filter((artist): artist is LidarrArtist => {
      if (!artist || seen.has(artist.foreignArtistId)) {
        return false;
      }
      seen.add(artist.foreignArtistId);
      return true;
    })
    .map((artist) =>
      mapArtist(artist, context.lidarrSettings, context.showLidarrUrl)
    );
};

const addedTime = (artist: LidarrArtist): number =>
  artist.added ? new Date(artist.added).getTime() : 0;

export const getRecentlyAddedArtists = (
  context: DiscoveryContext
): MusicArtistResult[] =>
  [...context.library.values()]
    .sort((a, b) => addedTime(b) - addedTime(a))
    .slice(0, MUSIC_SLIDER_SIZE)
    .map((artist) =>
      mapArtist(artist, context.lidarrSettings, context.showLidarrUrl)
    );

/**
 * Artists similar to the most recently added library artists, ranked by how
 * many seeds they are similar to and how closely, excluding artists that are
 * already in Lidarr.
 */
export const getSimilarToLibraryArtists = async (
  context: DiscoveryContext,
  lastfm: LastfmAPI
): Promise<MusicArtistResult[]> => {
  const seeds = [...context.library.values()]
    .sort((a, b) => addedTime(b) - addedTime(a))
    .slice(0, SIMILAR_SEED_COUNT);

  const similarLists = await mapWithConcurrency(
    seeds,
    LOOKUP_CONCURRENCY,
    async (seed) => {
      try {
        return await lastfm.getSimilarArtists({
          mbid: seed.foreignArtistId,
          name: seed.artistName,
          limit: 15,
        });
      } catch {
        // Last.fm does not know every MusicBrainz id; fall back to the name.
        try {
          return await lastfm.getSimilarArtists({
            name: seed.artistName,
            limit: 15,
          });
        } catch {
          return [];
        }
      }
    }
  );

  const libraryNames = new Set(
    [...context.library.values()].map((a) => a.artistName.toLowerCase())
  );
  const scores = new Map<string, { artist: LastfmArtist; score: number }>();

  for (const list of similarLists) {
    for (const artist of list) {
      if (
        (artist.mbid && context.library.has(artist.mbid)) ||
        libraryNames.has(artist.name.toLowerCase())
      ) {
        continue;
      }

      const key = artist.mbid || artist.name.toLowerCase();
      const entry = scores.get(key) ?? { artist, score: 0 };
      entry.score += 1 + (Number(artist.match) || 0);
      scores.set(key, entry);
    }
  }

  const ranked = [...scores.values()]
    .sort((a, b) => b.score - a.score)
    // Resolve a few extra in case some cannot be matched in Lidarr.
    .slice(0, MUSIC_SLIDER_SIZE + 10)
    .map((entry) => entry.artist);

  const results = await resolveLastfmArtists(context, ranked);

  return results
    .filter((artist) => !artist.inLidarr)
    .slice(0, MUSIC_SLIDER_SIZE);
};
