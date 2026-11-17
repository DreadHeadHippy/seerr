import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  followedSeasons,
  formatSeasonRanges,
  seasonProgress,
  seriesProgress,
  stallReason,
  torrentProgress,
  withLiveTorrents,
} from './seasonProgress';

const NOW = 1_700_000_000_000;

const item = (fields: {
  downloadId: string;
  season?: number;
  size?: number;
  sizeLeft?: number;
  status?: string;
  etaInMs?: number;
}) => ({
  downloadId: fields.downloadId,
  size: fields.size ?? 1000,
  sizeLeft: fields.sizeLeft ?? 500,
  status: fields.status ?? 'downloading',
  estimatedCompletionTime:
    fields.etaInMs === undefined ? undefined : new Date(NOW + fields.etaInMs),
  episode:
    fields.season === undefined ? undefined : { seasonNumber: fields.season },
});

describe('torrentProgress', () => {
  it('counts a season pack once, not once per episode', () => {
    // A 10 episode pack 10% done and a finished single episode.
    const pack = Array.from({ length: 10 }, () =>
      item({ downloadId: 'pack', size: 9000, sizeLeft: 8100, etaInMs: 60_000 })
    );
    const single = item({
      downloadId: 'single',
      size: 1000,
      sizeLeft: 0,
      etaInMs: 1000,
    });
    const state = torrentProgress([...pack, single], NOW);

    // (900 + 1000) of 10000 bytes.
    assert.ok(Math.abs(state.progress - 0.19) < 1e-9);
    assert.equal(state.etaMs, 60_000);
  });

  it('has no ETA while a torrent has none, and is done when all complete', () => {
    assert.equal(
      torrentProgress(
        [item({ downloadId: 'a' }), item({ downloadId: 'b', etaInMs: 1 })],
        NOW
      ).etaMs,
      undefined
    );
    assert.deepEqual(
      torrentProgress(
        [item({ downloadId: 'a', status: 'completed', sizeLeft: 0 })],
        NOW
      ),
      { progress: 1, etaMs: 0, done: true }
    );
    assert.deepEqual(torrentProgress([], NOW), {
      progress: 0,
      etaMs: undefined,
      done: false,
    });
  });
});

describe('followedSeasons', () => {
  it('takes requested seasons and seasons with downloads, minus specials', () => {
    assert.deepEqual(
      followedSeasons(
        [
          {
            status: MediaRequestStatus.APPROVED,
            seasons: [{ seasonNumber: 2 }, { seasonNumber: 1 }],
          },
          {
            status: MediaRequestStatus.DECLINED,
            seasons: [{ seasonNumber: 7 }],
          },
          {
            is4k: true,
            status: MediaRequestStatus.APPROVED,
            seasons: [{ seasonNumber: 8 }],
          },
          {
            status: MediaRequestStatus.PENDING,
            seasons: [{ seasonNumber: 0 }],
          },
        ],
        [item({ downloadId: 'x', season: 3 })]
      ),
      [1, 2, 3]
    );
  });
});

describe('seasonProgress', () => {
  it('places each season', () => {
    const seasons = seasonProgress(
      [1, 2, 3, 4, 5],
      [
        { seasonNumber: 1, status: MediaStatus.AVAILABLE },
        { seasonNumber: 2, status: MediaStatus.PROCESSING },
      ],
      [
        item({ downloadId: 'p2', season: 2, etaInMs: 30_000 }),
        item({
          downloadId: 'p3',
          season: 3,
          status: 'completed',
          sizeLeft: 0,
        }),
      ],
      new Set([4]),
      NOW
    );

    assert.deepEqual(
      seasons.map((s) => [s.seasonNumber, s.phase, s.progress]),
      [
        [1, 'available', 1],
        [2, 'downloading', 0.5],
        [3, 'importing', 1],
        [4, 'importing', 1],
        [5, 'waiting', 0],
      ]
    );
    assert.equal(seasons[1].etaMs, 30_000);
  });

  it('fills every season of a complete series pack together', () => {
    const seasons = seasonProgress(
      [1, 2],
      [],
      [
        item({ downloadId: 'all', season: 1, sizeLeft: 250 }),
        item({ downloadId: 'all', season: 2, sizeLeft: 250 }),
      ],
      new Set(),
      NOW
    );

    assert.deepEqual(
      seasons.map((s) => s.progress),
      [0.75, 0.75]
    );
  });
});

describe('seriesProgress', () => {
  it('averages the seasons and waits on the slowest', () => {
    const series = seriesProgress([
      { seasonNumber: 1, phase: 'available', progress: 1 },
      { seasonNumber: 2, phase: 'downloading', progress: 0.5, etaMs: 10 },
      { seasonNumber: 3, phase: 'downloading', progress: 0.5, etaMs: 40 },
      { seasonNumber: 4, phase: 'waiting', progress: 0 },
    ]);

    assert.equal(series.progress, 0.5);
    assert.equal(series.etaMs, 40);
    assert.deepEqual(series.ready, [1]);
    assert.equal(series.importing, false);
  });

  it('is importing once only imports are left', () => {
    assert.equal(
      seriesProgress([
        { seasonNumber: 1, phase: 'available', progress: 1 },
        { seasonNumber: 2, phase: 'importing', progress: 1 },
      ]).importing,
      true
    );
  });
});

describe('formatSeasonRanges', () => {
  it('collapses runs of seasons', () => {
    assert.equal(formatSeasonRanges([1]), 'S1');
    assert.equal(formatSeasonRanges([3, 1, 2, 5]), 'S1–3, S5');
    assert.equal(formatSeasonRanges([]), '');
  });
});

describe('withLiveTorrents', () => {
  it("uses qBittorrent's numbers for the torrents it has", () => {
    const [matched, other] = withLiveTorrents(
      [item({ downloadId: 'ABC' }), item({ downloadId: 'def' })],
      {
        abc: {
          size: 2000,
          sizeLeft: 100,
          status: 'downloading',
          estimatedCompletionTime: new Date(NOW + 5000).toISOString(),
        },
      }
    );

    assert.equal(matched.sizeLeft, 100);
    assert.equal(matched.size, 2000);
    assert.equal(other.sizeLeft, 500);
  });
});

describe('stallReason', () => {
  it('is undefined while everything has an ETA or is done', () => {
    assert.equal(
      stallReason([
        item({ downloadId: 'a', etaInMs: 10 }),
        item({ downloadId: 'b', status: 'completed', sizeLeft: 0 }),
      ]),
      undefined
    );
  });

  it('names paused and queued only when every unfinished one is', () => {
    assert.equal(
      stallReason([item({ downloadId: 'a', status: 'paused' })]),
      'paused'
    );
    assert.equal(
      stallReason([item({ downloadId: 'a', status: 'queued' })]),
      'queued'
    );
    assert.equal(
      stallReason([
        item({ downloadId: 'a', status: 'queued' }),
        item({ downloadId: 'b' }),
      ]),
      'stalled'
    );
  });
});
