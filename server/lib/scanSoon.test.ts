import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { anyDownloadLeft } from '@server/lib/scanSoon';

describe('anyDownloadLeft', () => {
  it('is false before anything was tracked', () => {
    assert.equal(anyDownloadLeft(undefined, ['a']), false);
    assert.equal(anyDownloadLeft([], []), false);
  });

  it('is false while every download is still queued', () => {
    assert.equal(anyDownloadLeft([{ downloadId: 'a' }], ['a', 'b']), false);
  });

  it('is true once a download leaves the queue', () => {
    assert.equal(
      anyDownloadLeft([{ downloadId: 'a' }, { downloadId: 'b' }], ['b']),
      true
    );
    assert.equal(anyDownloadLeft([{ downloadId: 'a' }], []), true);
  });
});
