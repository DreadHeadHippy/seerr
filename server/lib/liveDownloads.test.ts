import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { QBIT_NO_ETA, type QbitTorrent } from '@server/api/qbittorrent';
import { lastGoodReadings, toLiveProgress } from '@server/lib/liveDownloads';

const torrent = (fields: Partial<QbitTorrent>): QbitTorrent => ({
  hash: 'abc',
  progress: 0.5,
  size: 1000,
  amount_left: 500,
  eta: 600,
  state: 'downloading',
  dlspeed: 1,
  ...fields,
});

const NOW = 1_700_000_000_000;

describe('toLiveProgress', () => {
  it('turns qBittorrent seconds left into a completion time', () => {
    const live = toLiveProgress(torrent({}), NOW);
    assert.equal(live.status, 'downloading');
    assert.equal(live.sizeLeft, 500);
    assert.equal(live.estimatedCompletionTime?.getTime(), NOW + 600_000);
  });

  it('has no estimate while stalled or without one', () => {
    assert.equal(
      toLiveProgress(torrent({ state: 'stalledDL', dlspeed: 0 }), NOW)
        .estimatedCompletionTime,
      undefined
    );
    assert.equal(
      toLiveProgress(torrent({ eta: QBIT_NO_ETA }), NOW)
        .estimatedCompletionTime,
      undefined
    );
  });

  it('is completed once downloaded, even while seeding', () => {
    for (const state of ['uploading', 'stalledUP', 'stoppedUP']) {
      const live = toLiveProgress(
        torrent({ state, progress: 1, amount_left: 0 }),
        NOW
      );
      assert.equal(live.status, 'completed');
      assert.equal(live.sizeLeft, 0);
    }
  });

  it('maps queued, paused and errored torrents', () => {
    assert.equal(
      toLiveProgress(torrent({ state: 'queuedDL' })).status,
      'queued'
    );
    assert.equal(
      toLiveProgress(torrent({ state: 'stoppedDL' })).status,
      'paused'
    );
    assert.equal(
      toLiveProgress(torrent({ state: 'pausedDL' })).status,
      'paused'
    );
    assert.equal(toLiveProgress(torrent({ state: 'error' })).status, 'warning');
  });
});

describe('lastGoodReadings', () => {
  it('returns the kept readings for the wanted hashes only', () => {
    const reading = toLiveProgress(torrent({}), NOW);
    const kept = lastGoodReadings(
      ['abc', 'missing'],
      new Map([
        ['abc', reading],
        ['other', reading],
      ])
    );

    assert.deepEqual([...kept.keys()], ['abc']);
    assert.equal(kept.get('abc'), reading);
  });
});
