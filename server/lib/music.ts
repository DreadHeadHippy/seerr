import DeezerAPI from '@server/api/deezer';
import type LastfmAPI from '@server/api/lastfm';
import type { LastfmArtist } from '@server/api/lastfm';
import type ListenbrainzAPI from '@server/api/listenbrainz';
import type { FreshRelease } from '@server/api/listenbrainz';
import type {
  LidarrAlbum,
  LidarrArtist,
  LidarrImageWithRemote,
} from '@server/api/servarr/lidarr';
import LidarrAPI from '@server/api/servarr/lidarr';
import type {
  MusicAlbumResult,
  MusicArtistResult,
  MusicPersonalResponse,
} from '@server/interfaces/api/musicInterfaces';
import type { LidarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

/** Number of artists shown in each Music page slider. */
export const MUSIC_SLIDER_SIZE = 20;

/** Lidarr lookups run in parallel, but no more than this many at once. */
const LOOKUP_CONCURRENCY = 5;

/** How many recently added library artists seed "Recommended for You". */
const SIMILAR_SEED_COUNT = 12;

/** Number of "Because you like" rows, and the library artists they rotate through. */
const PERSONAL_SEED_COUNT = 4;
const PERSONAL_SEED_POOL = 20;

/** Number of "More {genre}" rows. */
const LIBRARY_GENRE_COUNT = 2;

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

export interface DiscoveryContext {
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

/** Last.fm similar artists for a seed, by MusicBrainz id or else by name. */
const getSimilarForSeed = async (
  lastfm: LastfmAPI,
  seed: { foreignArtistId: string; artistName: string },
  limit: number
): Promise<LastfmArtist[]> => {
  try {
    return await lastfm.getSimilarArtists({
      mbid: seed.foreignArtistId,
      name: seed.artistName,
      limit,
    });
  } catch {
    // Last.fm does not know every MusicBrainz id; fall back to the name.
    try {
      return await lastfm.getSimilarArtists({ name: seed.artistName, limit });
    } catch {
      return [];
    }
  }
};

const createLibraryMatcher = (context: DiscoveryContext) => {
  const libraryNames = new Set(
    [...context.library.values()].map((a) => a.artistName.toLowerCase())
  );

  return (artist: LastfmArtist): boolean =>
    (!!artist.mbid && context.library.has(artist.mbid)) ||
    libraryNames.has(artist.name.toLowerCase());
};

const recentLibrarySeeds = (context: DiscoveryContext): LidarrArtist[] =>
  [...context.library.values()]
    .sort((a, b) => addedTime(b) - addedTime(a))
    .slice(0, SIMILAR_SEED_COUNT);

/**
 * Artists similar to the most recently added library artists, ranked by how
 * many seeds they are similar to and how closely, excluding artists that are
 * already in Lidarr.
 */
export const getSimilarToLibraryArtists = async (
  context: DiscoveryContext,
  lastfm: LastfmAPI
): Promise<MusicArtistResult[]> => {
  const similarLists = await mapWithConcurrency(
    recentLibrarySeeds(context),
    LOOKUP_CONCURRENCY,
    (seed) => getSimilarForSeed(lastfm, seed, 15)
  );

  const inLibrary = createLibraryMatcher(context);
  const scores = new Map<string, { artist: LastfmArtist; score: number }>();

  for (const list of similarLists) {
    for (const artist of list) {
      if (inLibrary(artist)) {
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

/** Artists similar to one library artist, excluding artists already in Lidarr. */
export const getSimilarToArtist = async (
  context: DiscoveryContext,
  lastfm: LastfmAPI,
  foreignArtistId: string
): Promise<MusicArtistResult[]> => {
  const seed = context.library.get(foreignArtistId);

  if (!seed) {
    return [];
  }

  const inLibrary = createLibraryMatcher(context);
  const similar = (await getSimilarForSeed(lastfm, seed, 40))
    .filter((artist) => !inLibrary(artist))
    .slice(0, MUSIC_SLIDER_SIZE + 10);

  const results = await resolveLastfmArtists(context, similar);

  return results
    .filter((artist) => !artist.inLidarr)
    .slice(0, MUSIC_SLIDER_SIZE);
};

const trackFiles = (artist: LidarrArtist): number =>
  artist.statistics?.trackFileCount ?? 0;

const toSeed = (artist: LidarrArtist) => ({
  foreignArtistId: artist.foreignArtistId,
  artistName: artist.artistName,
});

/**
 * Picks the library artists for the "Because you like" rows: the artists with
 * the most music on disk, rotating daily so the rows change over time.
 */
export const getPersonalSeeds = (
  context: DiscoveryContext
): MusicPersonalResponse['seeds'] => {
  const pool = [...context.library.values()]
    .sort(
      (a, b) => trackFiles(b) - trackFiles(a) || addedTime(b) - addedTime(a)
    )
    .slice(0, PERSONAL_SEED_POOL);

  if (pool.length <= PERSONAL_SEED_COUNT) {
    return pool.map(toSeed);
  }

  const day = Math.floor(Date.now() / 86400000);
  const seeds: LidarrArtist[] = [];

  for (let i = 0; seeds.length < PERSONAL_SEED_COUNT; i++) {
    const artist = pool[(day * PERSONAL_SEED_COUNT + i) % pool.length];

    if (!seeds.includes(artist)) {
      seeds.push(artist);
    }
  }

  return seeds.map(toSeed);
};

/** The most common genres across the library's artists. */
export const getLibraryGenres = (
  context: DiscoveryContext,
  count = LIBRARY_GENRE_COUNT
): string[] => {
  const counts = new Map<string, { name: string; count: number }>();

  for (const artist of context.library.values()) {
    for (const genre of artist.genres ?? []) {
      const key = genre.toLowerCase();
      const entry = counts.get(key) ?? { name: genre, count: 0 };
      entry.count++;
      counts.set(key, entry);
    }
  }

  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, count)
    .map((entry) => entry.name);
};

const mapAlbum = (
  release: FreshRelease,
  libraryAlbum: LidarrAlbum | undefined,
  context: DiscoveryContext
): MusicAlbumResult => ({
  foreignAlbumId: release.releaseGroupMbid,
  title: release.title,
  albumType: release.type,
  artistName: release.artistName,
  foreignArtistId: release.artistMbids[0],
  releaseDate: release.releaseDate,
  coverUrl: release.coverUrl,
  inLidarr: !!libraryAlbum?.monitored,
  monitored: !!libraryAlbum?.monitored,
  hasFiles: (libraryAlbum?.statistics?.trackFileCount ?? 0) > 0,
  lidarrUrl:
    context.showLidarrUrl && libraryAlbum
      ? `${(
          context.lidarrSettings.externalUrl ||
          LidarrAPI.buildUrl(context.lidarrSettings)
        ).replace(/\/$/, '')}/album/${release.releaseGroupMbid}`
      : undefined,
});

const mapAlbums = (
  context: DiscoveryContext,
  releases: FreshRelease[]
): Promise<MusicAlbumResult[]> =>
  mapWithConcurrency(releases, LOOKUP_CONCURRENCY, async (release) =>
    mapAlbum(
      release,
      await context.lidarr
        .getLibraryAlbum(release.releaseGroupMbid)
        .catch(() => undefined),
      context
    )
  );

const TYPE_ORDER: Record<string, number> = { Album: 0, EP: 1, Single: 2 };

/** Most releases shown per artist in one row, so one artist can't fill it. */
const RELEASES_PER_ARTIST = 2;

/**
 * Keeps a release row varied: drops duplicate titles, limits each artist to a
 * couple of releases and prefers releases that have cover art, keeping the
 * incoming order otherwise.
 */
const diversifyReleases = (releases: FreshRelease[]): FreshRelease[] => {
  const perArtist = new Map<string, number>();
  const seenTitles = new Set<string>();
  const picked: FreshRelease[] = [];

  for (const release of [
    ...releases.filter((r) => r.coverUrl),
    ...releases.filter((r) => !r.coverUrl),
  ]) {
    const artistKey = release.artistMbids[0] ?? release.artistName;
    const titleKey = `${artistKey}\0${release.title.toLowerCase()}`;
    const count = perArtist.get(artistKey) ?? 0;

    if (count >= RELEASES_PER_ARTIST || seenTitles.has(titleKey)) {
      continue;
    }

    perArtist.set(artistKey, count + 1);
    seenTitles.add(titleKey);
    picked.push(release);
  }

  return picked.slice(0, MUSIC_SLIDER_SIZE);
};

/** This month's releases by artists already in Lidarr. */
export const getNewFromLibraryArtists = async (
  context: DiscoveryContext,
  listenbrainz: ListenbrainzAPI
): Promise<MusicAlbumResult[]> => {
  const releases = (await listenbrainz.getFreshReleases(30)).filter((release) =>
    release.artistMbids.some((mbid) => context.library.has(mbid))
  );

  return mapAlbums(context, diversifyReleases(releases));
};

/**
 * This week's releases by artists the user is likely to know but does not
 * have yet: artists similar to their library, in their library's top genres,
 * or on the Last.fm chart. Albums and EPs come before singles.
 */
export const getNewThisWeek = async (
  context: DiscoveryContext,
  lastfm: LastfmAPI,
  listenbrainz: ListenbrainzAPI
): Promise<MusicAlbumResult[]> => {
  const weights = new Map<string, number>();
  const addToPool = (artists: LastfmArtist[], weight: number) => {
    for (const artist of artists) {
      if (artist.mbid && !context.library.has(artist.mbid)) {
        weights.set(artist.mbid, (weights.get(artist.mbid) ?? 0) + weight);
      }
    }
  };

  const [similarLists, genreLists, chart] = await Promise.all([
    mapWithConcurrency(
      recentLibrarySeeds(context),
      LOOKUP_CONCURRENCY,
      (seed) => getSimilarForSeed(lastfm, seed, 50)
    ),
    mapWithConcurrency(getLibraryGenres(context), LOOKUP_CONCURRENCY, (tag) =>
      lastfm.getTopArtistsByTag({ tag, limit: 200 }).catch(() => [])
    ),
    lastfm.getTopArtists({ limit: 500 }).catch(() => []),
  ]);

  similarLists.forEach((list) => addToPool(list, 3));
  genreLists.forEach((list) => addToPool(list, 2));
  addToPool(chart, 1);

  const score = (release: FreshRelease) =>
    Math.max(0, ...release.artistMbids.map((mbid) => weights.get(mbid) ?? 0));

  for (const days of [7, 14]) {
    const releases = (await listenbrainz.getFreshReleases(days))
      .filter((release) => score(release) > 0)
      .sort(
        (a, b) =>
          (TYPE_ORDER[a.type] ?? 3) - (TYPE_ORDER[b.type] ?? 3) ||
          score(b) - score(a) ||
          b.releaseDate.localeCompare(a.releaseDate)
      );
    const picked = diversifyReleases(releases);

    // Widen to two weeks on a quiet week.
    if (picked.length >= 8 || days === 14) {
      return mapAlbums(context, picked);
    }
  }

  return [];
};
