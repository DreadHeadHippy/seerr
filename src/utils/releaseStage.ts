/**
 * Where a movie is in its release, from TMDB:
 * - unreleased: not out anywhere yet (announced, filming, post-production)
 * - inTheaters: out in cinemas, not yet to stream or buy
 * - released: out for home viewing, so there's something to download
 */
export type ReleaseStage = 'unreleased' | 'inTheaters' | 'released';

interface ReleaseInfo {
  /** TMDB's status, e.g. "Released", "Post Production". */
  status?: string;
  releases?: {
    results: { release_dates: { release_date: string; type: number }[] }[];
  };
}

/** TMDB release types: 1-3 cinema, 4 digital, 5 physical, 6 TV. */
const HOME_RELEASE_TYPE = 4;

/**
 * Cinema-only films older than this count as released: TMDB often lists no
 * digital date for older films.
 */
const THEATRICAL_WINDOW_MS = 120 * 24 * 60 * 60 * 1000;

export const movieReleaseStage = (
  movie: ReleaseInfo,
  now: number
): ReleaseStage => {
  if (movie.status && movie.status !== 'Released') {
    return 'unreleased';
  }

  const dates = (movie.releases?.results ?? []).flatMap(
    (country) => country.release_dates
  );
  const out = (type: (t: number) => boolean) =>
    dates
      .filter((d) => type(d.type))
      .map((d) => Date.parse(d.release_date))
      .filter((t) => Number.isFinite(t) && t <= now);

  if (out((t) => t >= HOME_RELEASE_TYPE).length > 0) {
    return 'released';
  }

  const inCinemas = out((t) => t < HOME_RELEASE_TYPE);

  return inCinemas.length > 0 &&
    now - Math.min(...inCinemas) < THEATRICAL_WINDOW_MS
    ? 'inTheaters'
    : 'released';
};
