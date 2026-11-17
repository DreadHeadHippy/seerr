import type { RadarrMovie } from '@server/api/servarr/radarr';
import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import { DeletionRequestStatus } from '@server/constants/deletion';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaRequest from '@server/entity/MediaRequest';
import Season from '@server/entity/Season';
import SeasonRequest from '@server/entity/SeasonRequest';
import { User } from '@server/entity/User';
import {
  approveDeletion,
  deleteMedia,
  loadOwnership,
  requestDeletion,
} from '@server/lib/deletion';
import type { RadarrSettings, SonarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { clearStorageCache, getStorageUsage } from '@server/lib/storage';
import { setupTestDb } from '@server/test/db';
import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';

const GB = 1024 ** 3;

// Instance arrow functions: swallow the assignment, serve these instead.
const stub = (proto: object, name: string, impl: () => unknown) =>
  Object.defineProperty(proto, name, {
    set() {},
    get() {
      return impl;
    },
    configurable: true,
  });

let movies: Partial<RadarrMovie>[] = [];
const removedMovies: number[] = [];
const removedSeasons: number[][] = [];
stub(RadarrAPI.prototype, 'getMovies', async () => movies);
stub(RadarrAPI.prototype, 'removeMovie', (async (tmdbId: number) => {
  removedMovies.push(tmdbId);
}) as () => unknown);
stub(SonarrAPI.prototype, 'removeSeasons', (async (
  _seriesId: number,
  seasons: number[]
) => {
  removedSeasons.push(seasons);
}) as () => unknown);
mock.method(MediaRequest, 'sendNotification', async () => undefined);

setupTestDb();

const server = {
  id: 0,
  name: 'test',
  hostname: 'localhost',
  port: 1,
  apiKey: 'key',
  useSsl: false,
  is4k: false,
  isDefault: true,
};

const users = async () => {
  const repository = getRepository(User);
  const admin = await repository.findOneOrFail({ where: { id: 1 } });
  const other = await repository.findOneOrFail({ where: { id: 2 } });
  return { admin, other };
};

const movieFor = async (requesters: User[], tmdbId = 100) => {
  const media = await getRepository(Media).save(
    new Media({
      tmdbId,
      mediaType: MediaType.MOVIE,
      status: MediaStatus.AVAILABLE,
      serviceId: 0,
      externalServiceId: 7,
    })
  );

  for (const requestedBy of requesters) {
    await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.MOVIE,
        status: MediaRequestStatus.COMPLETED,
        media,
        requestedBy,
        is4k: false,
      })
    );
  }

  return media;
};

describe('storage and deletion', () => {
  beforeEach(() => {
    // Nothing configured while saving, so requests aren't sent anywhere.
    getSettings().radarr = [];
    getSettings().sonarr = [];
    clearStorageCache();
    movies = [{ id: 7, sizeOnDisk: 8 * GB }];
    removedMovies.length = 0;
    removedSeasons.length = 0;
  });

  it("counts a user's share of what they requested", async () => {
    const { admin, other } = await users();
    await movieFor([admin, other]);
    getSettings().radarr = [server as RadarrSettings];
    other.storageLimitGb = 4;

    const usage = await getStorageUsage(other);

    assert.equal(usage.usedBytes, 4 * GB);
    assert.equal(usage.limitBytes, 4 * GB);
    assert.equal(usage.restricted, true);
    assert.equal(usage.items[0].shared, true);
  });

  it('deletes a movie and marks it deleted', async () => {
    const { other } = await users();
    const media = await movieFor([other]);
    getSettings().radarr = [server as RadarrSettings];

    assert.equal((await loadOwnership(other, media)).owns, true);
    await deleteMedia(media);

    const after = await getRepository(Media).findOneOrFail({
      where: { id: media.id },
    });
    assert.deepEqual(removedMovies, [100]);
    assert.equal(after.status, MediaStatus.DELETED);
    assert.equal(after.externalServiceId, null);
  });

  it('deletes only the chosen seasons of a series', async () => {
    const { other } = await users();
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 200,
        tvdbId: 200,
        mediaType: MediaType.TV,
        status: MediaStatus.AVAILABLE,
        serviceId: 0,
        externalServiceId: 9,
        seasons: [1, 2].map(
          (seasonNumber) =>
            new Season({ seasonNumber, status: MediaStatus.AVAILABLE })
        ),
      })
    );
    await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.TV,
        status: MediaRequestStatus.COMPLETED,
        media,
        requestedBy: other,
        is4k: false,
        seasons: [
          new SeasonRequest({
            seasonNumber: 2,
            status: MediaRequestStatus.COMPLETED,
          }),
        ],
      })
    );
    getSettings().sonarr = [server as SonarrSettings];

    await deleteMedia(
      await getRepository(Media).findOneOrFail({ where: { id: media.id } }),
      [2]
    );

    const after = await getRepository(Media).findOneOrFail({
      where: { id: media.id },
    });
    assert.deepEqual(removedSeasons, [[2]]);
    assert.equal(after.status, MediaStatus.PARTIALLY_AVAILABLE);
    assert.deepEqual(
      after.seasons
        .sort((a, b) => a.seasonNumber - b.seasonNumber)
        .map((s) => s.status),
      [MediaStatus.AVAILABLE, MediaStatus.DELETED]
    );
  });

  it('turns an approved request into a deletion', async () => {
    const { admin, other } = await users();
    const media = await movieFor([admin, other], 300);
    getSettings().radarr = [server as RadarrSettings];

    const request = await requestDeletion(other, media, [], 'Watched it');
    // Asking again updates the same request.
    const again = await requestDeletion(other, media, []);
    assert.equal(again.id, request.id);
    assert.equal(again.reason, 'Watched it');

    const approved = await approveDeletion(again, admin);

    assert.equal(approved.status, DeletionRequestStatus.APPROVED);
    assert.deepEqual(removedMovies, [300]);
  });
});
