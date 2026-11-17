import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type LidarrAPI from '@server/api/servarr/lidarr';
import type { LidarrQueueItem } from '@server/api/servarr/lidarr';
import { attachDownloads, getMusicDownloads } from '@server/lib/musicDownloads';

const MINUTE = 60 * 1000;

const lidarrWithQueue = (queue: LidarrQueueItem[]) =>
  ({ getDownloadQueue: async () => queue }) as unknown as LidarrAPI;

const item = (overrides: Partial<LidarrQueueItem>): LidarrQueueItem => ({
  size: 100,
  sizeleft: 50,
  status: 'downloading',
  trackedDownloadState: 'downloading',
  album: { foreignAlbumId: 'album-1' },
  artist: { foreignArtistId: 'artist-1' },
  ...overrides,
});

describe('getMusicDownloads', () => {
  it('adds the import time to the download ETA', async () => {
    const finishesAt = Date.now() + 20 * MINUTE;
    const downloads = await getMusicDownloads(
      lidarrWithQueue([
        item({ estimatedCompletionTime: new Date(finishesAt).toISOString() }),
      ])
    );

    const album = downloads.albums.get('album-1');
    assert.ok(album?.readyAt);
    assert.strictEqual(album.progress, 0.5);
    // 20 minutes of downloading plus 5 for import and Plex.
    assert.strictEqual(Date.parse(album.readyAt) - finishesAt, 5 * MINUTE);
    assert.ok(downloads.artists.has('artist-1'));
  });

  it('uses the slowest part of an album and combines progress', async () => {
    const soon = Date.now() + 5 * MINUTE;
    const later = Date.now() + 40 * MINUTE;
    const downloads = await getMusicDownloads(
      lidarrWithQueue([
        item({
          sizeleft: 0,
          estimatedCompletionTime: new Date(soon).toISOString(),
        }),
        item({
          sizeleft: 100,
          estimatedCompletionTime: new Date(later).toISOString(),
        }),
      ])
    );

    const album = downloads.albums.get('album-1');
    assert.strictEqual(album?.progress, 0.5);
    assert.strictEqual(Date.parse(album?.readyAt ?? ''), later + 5 * MINUTE);
  });

  it('gives no ETA while a download is queued or stalled', async () => {
    const downloads = await getMusicDownloads(
      lidarrWithQueue([item({ status: 'queued' })])
    );

    assert.strictEqual(downloads.albums.get('album-1')?.readyAt, undefined);
  });

  it('skips failed downloads and survives an unreachable Lidarr', async () => {
    const failed = await getMusicDownloads(
      lidarrWithQueue([item({ trackedDownloadState: 'failed' })])
    );
    assert.strictEqual(failed.albums.size, 0);

    const broken = await getMusicDownloads({
      getDownloadQueue: async () => {
        throw new Error('connection refused');
      },
    } as unknown as LidarrAPI);
    assert.strictEqual(broken.albums.size, 0);
  });
});

describe('attachDownloads', () => {
  it('marks albums by album and artists by artist', async () => {
    const downloads = await getMusicDownloads(
      lidarrWithQueue([
        item({
          estimatedCompletionTime: new Date(Date.now() + MINUTE).toISOString(),
        }),
      ])
    );

    const response = attachDownloads(
      {
        artist: { foreignArtistId: 'artist-1' },
        releases: [
          { foreignAlbumId: 'album-1', foreignArtistId: 'artist-1' },
          // Same artist, but this album is not downloading.
          { foreignAlbumId: 'album-2', foreignArtistId: 'artist-1' },
        ],
      },
      downloads
    ) as {
      artist: { download?: unknown };
      releases: { download?: unknown }[];
    };

    assert.ok(response.artist.download);
    assert.ok(response.releases[0].download);
    assert.strictEqual(response.releases[1].download, undefined);
  });
});
