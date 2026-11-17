import dataSource from '@server/datasource';
import { MusicBlocklist } from '@server/entity/MusicBlocklist';

/** MusicBrainz ids of every blocklisted artist. */
export const getBlocklistedArtistIds = async (): Promise<Set<string>> => {
  const rows = await dataSource
    .getRepository(MusicBlocklist)
    .find({ select: { foreignArtistId: true } });

  return new Set(rows.map((row) => row.foreignArtistId));
};

export const isArtistBlocklisted = async (
  foreignArtistId: string
): Promise<boolean> =>
  dataSource.getRepository(MusicBlocklist).exists({
    where: { foreignArtistId },
  });

type ArtistLike = { foreignArtistId?: string };

/**
 * Drops blocklisted artists (and albums by them) from a Music page response:
 * `{ results }` for artist and album rows, `{ seeds }` for the personal rows.
 */
export const removeBlocklisted = <T>(response: T, blocked: Set<string>): T => {
  if (blocked.size === 0 || !response || typeof response !== 'object') {
    return response;
  }

  const allowed = (item: ArtistLike) =>
    !item.foreignArtistId || !blocked.has(item.foreignArtistId);
  const filtered = { ...response } as Record<string, unknown>;

  for (const key of ['results', 'seeds']) {
    const list = filtered[key];

    if (Array.isArray(list)) {
      filtered[key] = (list as ArtistLike[]).filter(allowed);
    }
  }

  return filtered as T;
};
