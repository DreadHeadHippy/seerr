import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MediaType } from '@server/constants/media';
import { ownership } from '@server/lib/deletion';
import { userShares } from '@server/lib/storage';

const GB = 1024 ** 3;

describe('userShares', () => {
  it('splits a movie evenly between its requesters', () => {
    const shares = userShares(
      1,
      [
        { userId: 1, mediaId: 10, is4k: false, seasons: [] },
        { userId: 2, mediaId: 10, is4k: false, seasons: [] },
      ],
      () => ({ total: 10 * GB })
    );

    assert.deepEqual(
      shares.map((s) => [s.mediaId, s.bytes / GB, s.shared]),
      [[10, 5, true]]
    );
  });

  it('counts only the seasons each user asked for', () => {
    const seasons = new Map([
      [1, 4 * GB],
      [2, 6 * GB],
      [3, 8 * GB],
    ]);
    const requests = [
      // User 1 asked for seasons 1 and 2, user 2 for seasons 2 and 3.
      { userId: 1, mediaId: 20, is4k: false, seasons: [1, 2] },
      { userId: 2, mediaId: 20, is4k: false, seasons: [2, 3] },
    ];

    const [mine] = userShares(1, requests, () => ({ seasons }));
    const [theirs] = userShares(2, requests, () => ({ seasons }));

    // Season 1 alone (4) plus half of season 2 (3).
    assert.equal(mine.bytes / GB, 7);
    // Half of season 2 (3) plus season 3 alone (8).
    assert.equal(theirs.bytes / GB, 11);
    assert.equal(mine.shared, true);
  });

  it('merges a user\u2019s separate requests for the same series', () => {
    const shares = userShares(
      1,
      [
        { userId: 1, mediaId: 30, is4k: false, seasons: [1] },
        { userId: 1, mediaId: 30, is4k: false, seasons: [2] },
      ],
      () => ({
        seasons: new Map([
          [1, GB],
          [2, GB],
        ]),
      })
    );

    assert.equal(shares.length, 1);
    assert.equal(shares[0].bytes / GB, 2);
    assert.equal(shares[0].shared, false);
  });

  it('counts nothing for titles without sizes', () => {
    assert.equal(
      userShares(
        1,
        [{ userId: 1, mediaId: 40, is4k: false, seasons: [] }],
        () => undefined
      )[0].bytes,
      0
    );
  });
});

describe('ownership', () => {
  it('owns a movie, shared when others requested it', () => {
    assert.deepEqual(
      ownership(1, MediaType.MOVIE, [
        { userId: 1, seasons: [] },
        { userId: 2, seasons: [] },
      ]),
      { owns: true, shared: true, seasons: [] }
    );
    assert.equal(
      ownership(3, MediaType.MOVIE, [{ userId: 1, seasons: [] }]).owns,
      false
    );
  });

  it('owns the seasons they asked for, marking shared ones', () => {
    assert.deepEqual(
      ownership(1, MediaType.TV, [
        { userId: 1, seasons: [2, 1, 0] },
        { userId: 2, seasons: [2, 3] },
      ]),
      {
        owns: true,
        shared: false,
        seasons: [
          { seasonNumber: 1, shared: false },
          { seasonNumber: 2, shared: true },
        ],
      }
    );
  });
});
