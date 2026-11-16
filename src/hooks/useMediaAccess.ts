import useSettings from '@app/hooks/useSettings';
import { Permission, useUser } from '@app/hooks/useUser';

export interface MediaAccess {
  movie: boolean;
  tv: boolean;
  music: boolean;
}

/**
 * Which media types the current user should be shown when browsing.
 *
 * Users with the general Request permission (or no request permissions at
 * all, e.g. view-only accounts) see everything. Users who were only given
 * specific request types (e.g. only Request Music) only see those types, so
 * a music-only user is not shown movies and series they cannot request.
 */
const useMediaAccess = (): MediaAccess => {
  const { hasPermission } = useUser();
  const { currentSettings } = useSettings();

  const can = (permissions: Permission[]) =>
    hasPermission(permissions, { type: 'or' });

  const movie = can([
    Permission.REQUEST,
    Permission.REQUEST_MOVIE,
    Permission.REQUEST_4K,
    Permission.REQUEST_4K_MOVIE,
  ]);
  const tv = can([
    Permission.REQUEST,
    Permission.REQUEST_TV,
    Permission.REQUEST_4K,
    Permission.REQUEST_4K_TV,
  ]);
  const music = can([Permission.REQUEST, Permission.REQUEST_MUSIC]);

  const restricted = movie || tv || music;

  return {
    movie: movie || !restricted,
    tv: tv || !restricted,
    music: currentSettings.musicEnabled && (music || !restricted),
  };
};

export default useMediaAccess;

export type BrowseSection = 'discover' | keyof MediaAccess;

/**
 * Whether a navigation section should be shown. Discover mixes movies and
 * series, so it is shown when either of them is.
 */
export const isSectionVisible = (
  access: MediaAccess,
  section?: BrowseSection
): boolean => {
  if (!section) {
    return true;
  }

  if (section === 'discover') {
    return access.movie || access.tv;
  }

  return access[section];
};
