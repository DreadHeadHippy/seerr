import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { liveDownloadState } from './useLiveDownload';

const READ_AT = 1_700_000_000_000;

const download = (fields: {
  size?: number;
  sizeLeft?: number;
  status?: string;
  etaInMs?: number;
}) => ({
  size: fields.size ?? 1000,
  sizeLeft: fields.sizeLeft ?? 500,
  status: fields.status ?? 'downloading',
  estimatedCompletionTime:
    fields.etaInMs === undefined
      ? undefined
      : new Date(READ_AT + fields.etaInMs),
});

describe('liveDownloadState', () => {
  it('starts at the reading', () => {
    const state = liveDownloadState(
      [download({ etaInMs: 100_000 })],
      READ_AT,
      READ_AT
    );
    assert.equal(state.progress, 0.5);
    assert.equal(state.etaMs, 100_000);
    assert.equal(state.done, false);
  });

  it('carries on at the speed the ETA implies', () => {
    const state = liveDownloadState(
      [download({ etaInMs: 100_000 })],
      READ_AT,
      READ_AT + 50_000
    );
    assert.equal(state.progress, 0.75);
    assert.equal(state.etaMs, 50_000);
  });

  it('never guesses its way to finished', () => {
    const state = liveDownloadState(
      [download({ etaInMs: 10_000 })],
      READ_AT,
      READ_AT + 60_000
    );
    assert.equal(state.progress, 0.99);
    assert.equal(state.etaMs, 0);
    assert.equal(state.done, false);
  });

  it('holds still and has no ETA without one', () => {
    const state = liveDownloadState(
      [download({}), download({ etaInMs: 10_000 })],
      READ_AT,
      READ_AT + 5_000
    );
    assert.equal(state.etaMs, undefined);
    // 500 left on the stalled one, 250 on the moving one, of 2000.
    assert.equal(state.progress, 0.625);
  });

  it('is done once every download is complete', () => {
    const state = liveDownloadState(
      [download({ status: 'completed', sizeLeft: 0 })],
      READ_AT,
      READ_AT
    );
    assert.deepEqual(state, { progress: 1, etaMs: 0, done: true });
  });

  it('is empty without downloads', () => {
    assert.deepEqual(liveDownloadState([], READ_AT, READ_AT), {
      progress: 0,
      etaMs: undefined,
      done: false,
    });
  });
});
