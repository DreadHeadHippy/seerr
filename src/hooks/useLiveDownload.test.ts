import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { downloadState, withLiveTorrents } from './useLiveDownload';

const NOW = 1_700_000_000_000;

const download = (fields: {
  downloadId?: string;
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
});

describe('withLiveTorrents', () => {
  it("uses qBittorrent's numbers for the torrents it has", () => {
    const [matched, other] = withLiveTorrents(
      [download({ downloadId: 'ABC' }), download({ downloadId: 'def' })],
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

describe('downloadState', () => {
  it('reports progress and time left', () => {
    const state = downloadState([download({ etaInMs: 100_000 })], NOW);
    assert.equal(state.progress, 0.5);
    assert.equal(state.etaMs, 100_000);
    assert.equal(state.done, false);
  });

  it('has no ETA while any download has none', () => {
    const state = downloadState(
      [download({}), download({ etaInMs: 10_000 })],
      NOW
    );
    assert.equal(state.etaMs, undefined);
    assert.equal(state.progress, 0.5);
  });

  it('is done once every download is complete', () => {
    assert.deepEqual(
      downloadState([download({ status: 'completed', sizeLeft: 0 })], NOW),
      { progress: 1, etaMs: 0, done: true }
    );
  });

  it('is empty without downloads', () => {
    assert.deepEqual(downloadState([], NOW), {
      progress: 0,
      etaMs: undefined,
      done: false,
    });
  });
});
