import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MediaType } from '@server/constants/media';
import { parseArrWebhook } from '@server/lib/arrWebhook';

describe('parseArrWebhook', () => {
  it('reads a Radarr grab', () => {
    const event = parseArrWebhook('radarr', {
      eventType: 'Grab',
      downloadId: 'ABC123',
      movie: { id: 7, title: 'A Movie' },
      release: { releaseTitle: 'A.Movie.2024.1080p', size: 2000 },
    });

    assert.equal(event.type, 'grab');
    assert.ok(event.type === 'grab');
    assert.equal(event.downloadId, 'abc123');
    assert.equal(event.items.length, 1);
    assert.equal(event.items[0].mediaType, MediaType.MOVIE);
    assert.equal(event.items[0].externalId, 7);
    assert.equal(event.items[0].sizeLeft, 2000);
    assert.equal(event.items[0].title, 'A.Movie.2024.1080p');
  });

  it('lists a Sonarr season pack once per episode', () => {
    const event = parseArrWebhook('sonarr', {
      eventType: 'Grab',
      downloadId: 'def',
      series: { id: 3, title: 'A Show' },
      episodes: [
        { id: 10, seasonNumber: 1, episodeNumber: 1 },
        { id: 11, seasonNumber: 1, episodeNumber: 2 },
      ],
      release: { size: 5000 },
    });

    assert.ok(event.type === 'grab');
    assert.deepEqual(
      event.items.map((item) => item.episode?.episodeNumber),
      [1, 2]
    );
    assert.ok(event.items.every((item) => item.externalId === 3));
  });

  it('reads Lidarr MusicBrainz ids', () => {
    const event = parseArrWebhook('lidarr', {
      eventType: 'Grab',
      downloadId: 'GHI',
      artist: { mbId: 'artist-mbid' },
      albums: [{ mbId: 'album-1' }, { foreignAlbumId: 'album-2' }, {}],
      release: { size: 100 },
    });

    assert.ok(event.type === 'grab');
    assert.equal(event.artistId, 'artist-mbid');
    assert.deepEqual(event.albumIds, ['album-1', 'album-2']);
    assert.equal(event.items.length, 0);
  });

  it('reads imports, with or without a download id', () => {
    assert.deepEqual(
      parseArrWebhook('radarr', { eventType: 'Download', downloadId: 'XY' }),
      { type: 'import', downloadId: 'xy' }
    );
    assert.deepEqual(parseArrWebhook('sonarr', { eventType: 'Download' }), {
      type: 'import',
      downloadId: undefined,
    });
    assert.equal(
      parseArrWebhook('sonarr', { eventType: 'ImportComplete' }).type,
      'import'
    );
  });

  it('ignores other events and junk', () => {
    assert.equal(parseArrWebhook('radarr', { eventType: 'Test' }).type, 'test');
    assert.equal(
      parseArrWebhook('radarr', { eventType: 'Rename' }).type,
      'ignored'
    );
    assert.equal(
      parseArrWebhook('radarr', { eventType: 'Grab' }).type,
      'ignored'
    );
    assert.equal(parseArrWebhook('radarr', null).type, 'ignored');
  });
});
