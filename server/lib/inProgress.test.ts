import type { RadarrMovie } from '@server/api/servarr/radarr';
import RadarrAPI from '@server/api/servarr/radarr';
import type { SonarrSeries } from '@server/api/servarr/sonarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import TheMovieDb from '@server/api/themoviedb';
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
  classifyMovie,
  classifySeries,
  clearInProgressCache,
  getInProgress,
} from '@server/lib/inProgress';
import type { RadarrSettings, SonarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';

const idle = { downloading: false, importing: false, sent: true };

describe('classifyMovie', () => {
  it('trusts the download tracker first', () => {
    assert.equal(
      classifyMovie({ ...idle, downloading: true, movie: undefined }),
      'downloading'
    );
    assert.equal(
      classifyMovie({ ...idle, importing: true, movie: undefined }),
      'importing'
    );
  });

  it('leaves out movies Radarr has, or isn\u2019t looking for', () => {
    const movie = { hasFile: true, monitored: true, isAvailable: true };
    assert.equal(classifyMovie({ ...idle, movie }), undefined);
    assert.equal(
      classifyMovie({
        ...idle,
        movie: { ...movie, hasFile: false, monitored: false },
      }),
      undefined
    );
  });

  it('tells searching from not released yet', () => {
    const movie = { hasFile: false, monitored: true, isAvailable: true };
    assert.equal(classifyMovie({ ...idle, movie }), 'searching');
    assert.equal(
      classifyMovie({ ...idle, movie: { ...movie, isAvailable: false } }),
      'unreleased'
    );
  });

  it('flags requests that never reached Radarr', () => {
    assert.equal(
      classifyMovie({ ...idle, sent: false, movie: null }),
      'notSent'
    );
    assert.equal(classifyMovie({ ...idle, movie: null }), 'notSent');
  });

  it('shows it as searching when Radarr does not answer', () => {
    assert.equal(classifyMovie({ ...idle, movie: undefined }), 'searching');
  });
});

describe('classifySeries', () => {
  const season = (
    seasonNumber: number,
    episodeFileCount: number,
    episodeCount: number,
    monitored = true
  ) => ({
    seasonNumber,
    monitored,
    statistics: {
      episodeFileCount,
      episodeCount,
      totalEpisodeCount: 10,
      sizeOnDisk: 0,
      percentOfEpisodes: 0,
    },
  });

  it('is searching while a requested season misses aired episodes', () => {
    assert.equal(
      classifySeries({
        ...idle,
        series: { seasons: [season(1, 10, 10), season(2, 3, 6)] },
        seasons: [1, 2],
      }),
      'searching'
    );
  });

  it('leaves out series with everything aired so far', () => {
    assert.equal(
      classifySeries({
        ...idle,
        // Season 2 airing: 6 aired, all in. Season 3 not aired at all.
        series: { seasons: [season(2, 6, 6), season(3, 0, 0)] },
        seasons: [2, 3],
      }),
      undefined
    );
  });

  it('ignores seasons nobody requested or Sonarr is not monitoring', () => {
    assert.equal(
      classifySeries({
        ...idle,
        series: { seasons: [season(1, 0, 10), season(2, 0, 10, false)] },
        seasons: [2],
      }),
      undefined
    );
  });
});

// Radarr's getMovie is an instance arrow function; swallow the assignment.
let radarrMovie: (
  id: number
) => Promise<Partial<RadarrMovie>> = async () => ({});
Object.defineProperty(RadarrAPI.prototype, 'getMovie', {
  set() {},
  get() {
    return async ({ id }: { id: number }) => radarrMovie(id);
  },
  configurable: true,
});
let sonarrSeries: (
  id: number
) => Promise<Partial<SonarrSeries>> = async () => ({
  seasons: [],
});
mock.method(SonarrAPI.prototype, 'getSeriesById', (id: number) =>
  sonarrSeries(id)
);
mock.method(MediaRequest, 'sendNotification', async () => undefined);
// Turning a movie available notifies its requester, which reads TMDB.
Object.defineProperty(TheMovieDb.prototype, 'getMovie', {
  set() {},
  get() {
    return async () => ({ id: 1, title: 'Movie', overview: '' });
  },
  configurable: true,
});

describe('getInProgress', () => {
  setupTestDb();

  beforeEach(() => {
    clearInProgressCache();
    // Nothing configured while saving, so requests aren't sent anywhere.
    getSettings().radarr = [];
    getSettings().sonarr = [];
  });

  const configureArrs = () => {
    const server = {
      id: 0,
      name: 'test',
      hostname: 'localhost',
      port: 1,
      apiKey: 'key',
      useSsl: false,
      is4k: false,
      isDefault: true,
      syncEnabled: true,
    };
    getSettings().radarr = [server as RadarrSettings];
    getSettings().sonarr = [server as SonarrSettings];
  };

  const requestMovie = async (
    tmdbId: number,
    status = MediaRequestStatus.APPROVED,
    externalServiceId: number | undefined = tmdbId
  ) => {
    const requestedBy = await getRepository(User).findOneOrFail({
      where: { id: 1 },
    });
    const media = await getRepository(Media).save(
      new Media({
        tmdbId,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.PROCESSING,
        serviceId: 0,
        externalServiceId,
      })
    );
    await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.MOVIE,
        status,
        media,
        requestedBy,
        is4k: false,
      })
    );
  };

  it('checks movies with Radarr', async () => {
    await requestMovie(1); // in the library
    await requestMovie(2); // missing, released
    await requestMovie(3); // not out yet
    await requestMovie(4, MediaRequestStatus.FAILED); // never reached Radarr
    await requestMovie(5, MediaRequestStatus.PENDING); // not approved
    configureArrs();
    radarrMovie = async (id) => ({
      id,
      tmdbId: id,
      title: `Movie ${id}`,
      titleSlug: `movie-${id}`,
      hasFile: id === 1,
      monitored: true,
      isAvailable: id !== 3,
    });

    const items = await getInProgress();

    assert.deepEqual(
      items.map((item) => [item.tmdbId, item.phase]),
      [
        [2, 'searching'],
        [3, 'unreleased'],
        [4, 'notSent'],
      ]
    );

    // Movie 1 is in Radarr's library but Seerr still had it processing:
    // corrected in the background, without waiting for a scan.
    let status: MediaStatus | undefined;
    for (let i = 0; i < 50 && status !== MediaStatus.AVAILABLE; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      status = (
        await getRepository(Media).findOneOrFail({ where: { tmdbId: 1 } })
      ).status;
    }
    assert.equal(status, MediaStatus.AVAILABLE);
  });

  it('leaves out series with everything aired so far', async () => {
    // Correcting series 10's status would look it up on TMDB; not tested here.
    const { sonarrScanner } = await import('@server/lib/scanners/sonarr');
    const syncOne = mock.method(
      sonarrScanner,
      'syncOne',
      async () => undefined
    );
    const requestedBy = await getRepository(User).findOneOrFail({
      where: { id: 1 },
    });
    const show = async (tmdbId: number) => {
      const media = await getRepository(Media).save(
        new Media({
          tmdbId,
          tvdbId: tmdbId,
          mediaType: MediaType.TV,
          status: MediaStatus.PARTIALLY_AVAILABLE,
          serviceId: 0,
          externalServiceId: tmdbId,
          seasons: [
            new Season({ seasonNumber: 1, status: MediaStatus.AVAILABLE }),
            new Season({ seasonNumber: 2, status: MediaStatus.PROCESSING }),
          ],
        })
      );
      await getRepository(MediaRequest).save(
        new MediaRequest({
          type: MediaType.TV,
          status: MediaRequestStatus.APPROVED,
          media,
          requestedBy,
          is4k: false,
          seasons: [
            new SeasonRequest({
              seasonNumber: 2,
              status: MediaRequestStatus.APPROVED,
            }),
          ],
        })
      );
    };

    await show(10); // season 2 airing, all aired episodes in
    await show(11); // season 2 missing aired episodes
    configureArrs();
    sonarrSeries = async (id) => ({
      seasons: [
        {
          seasonNumber: 2,
          monitored: true,
          statistics: {
            episodeFileCount: id === 10 ? 6 : 2,
            episodeCount: 6,
            totalEpisodeCount: 10,
            sizeOnDisk: 0,
            percentOfEpisodes: 0,
          },
        },
      ],
    });

    const items = await getInProgress();

    assert.deepEqual(
      items.map((item) => [item.tmdbId, item.phase]),
      [[11, 'searching']]
    );
    syncOne.mock.restore();
  });
});
