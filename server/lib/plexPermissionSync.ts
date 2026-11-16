import PlexTvAPI from '@server/api/plextv';
import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

/** Request permissions managed by the sync. Other permissions are untouched. */
const MANAGED_REQUEST_PERMISSIONS =
  Permission.REQUEST |
  Permission.REQUEST_MOVIE |
  Permission.REQUEST_TV |
  Permission.REQUEST_MUSIC;

/**
 * Computes a user's permissions from the Plex library types shared with them:
 * movie libraries grant Request Movies, TV libraries Request Series and music
 * libraries Request Music. 4K request permissions are removed for types the
 * user no longer has, but never added.
 */
export const permissionsForLibraryTypes = (
  current: number,
  libraryTypes: Set<string>
): number => {
  const movie = libraryTypes.has('movie');
  const tv = libraryTypes.has('show');
  const music = libraryTypes.has('artist');

  let permissions = current & ~MANAGED_REQUEST_PERMISSIONS;

  if (movie) permissions |= Permission.REQUEST_MOVIE;
  if (tv) permissions |= Permission.REQUEST_TV;
  if (music) permissions |= Permission.REQUEST_MUSIC;

  if (!movie) permissions &= ~Permission.REQUEST_4K_MOVIE;
  if (!tv) permissions &= ~Permission.REQUEST_4K_TV;
  if (!movie || !tv) permissions &= ~Permission.REQUEST_4K;

  return permissions;
};

let running = false;

/**
 * Sets request permissions from each Plex user's library access. Only users
 * found in the server's share list are changed; admins and the owner are
 * never changed. Pass a user to sync only that user (used on sign-in).
 */
export const syncPlexRequestPermissions = async (
  onlyUser?: User
): Promise<{ updated: number }> => {
  const settings = getSettings();

  if (
    !settings.main.syncPlexLibraryPermissions ||
    settings.main.mediaServerType !== MediaServerType.PLEX ||
    !settings.plex.machineId
  ) {
    return { updated: 0 };
  }

  if (!onlyUser && running) {
    return { updated: 0 };
  }

  if (!onlyUser) {
    running = true;
  }

  try {
    const userRepository = getRepository(User);
    const owner = await userRepository.findOne({
      select: { id: true, plexToken: true },
      where: { id: 1 },
    });

    if (!owner?.plexToken) {
      throw new Error('The owner account has no Plex token');
    }

    const sharedTypes = await new PlexTvAPI(
      owner.plexToken
    ).getSharedLibraryTypes(settings.plex.machineId);

    const users = onlyUser
      ? [onlyUser]
      : await userRepository.find({ where: { userType: UserType.PLEX } });

    let updated = 0;

    for (const user of users) {
      if (
        user.id === owner.id ||
        !user.plexId ||
        user.hasPermission(Permission.ADMIN)
      ) {
        continue;
      }

      const libraryTypes = sharedTypes.get(user.plexId);

      if (!libraryTypes) {
        continue;
      }

      const permissions = permissionsForLibraryTypes(
        user.permissions,
        libraryTypes
      );

      if (permissions !== user.permissions) {
        logger.info('Updating request permissions from Plex library access', {
          label: 'Plex Permission Sync',
          userId: user.id,
          libraryTypes: [...libraryTypes],
          from: user.permissions,
          to: permissions,
        });
        user.permissions = permissions;
        await userRepository.save(user);
        updated++;
      }
    }

    if (!onlyUser) {
      logger.info(
        `Plex permission sync complete. Updated ${updated} user(s).`,
        {
          label: 'Plex Permission Sync',
        }
      );
    }

    return { updated };
  } catch (e) {
    logger.error('Failed to sync request permissions from Plex', {
      label: 'Plex Permission Sync',
      errorMessage: e.message,
    });
    return { updated: 0 };
  } finally {
    if (!onlyUser) {
      running = false;
    }
  }
};
