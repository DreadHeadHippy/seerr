import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { movieReleaseStage } from './releaseStage';

const NOW = Date.parse('2026-11-17T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const date = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();
const releases = (...dates: [number, number][]) => ({
  results: [
    {
      release_dates: dates.map(([type, daysAgo]) => ({
        type,
        release_date: date(daysAgo),
      })),
    },
  ],
});

describe('movieReleaseStage', () => {
  it('is unreleased until TMDB says released', () => {
    assert.equal(
      movieReleaseStage({ status: 'Post Production' }, NOW),
      'unreleased'
    );
    assert.equal(movieReleaseStage({ status: 'Planned' }, NOW), 'unreleased');
  });

  it('is in theaters while only cinemas have it', () => {
    assert.equal(
      movieReleaseStage(
        // In cinemas 20 days ago, digital due in 30 days.
        { status: 'Released', releases: releases([3, 20], [4, -30]) },
        NOW
      ),
      'inTheaters'
    );
  });

  it('is released once it is out to stream or buy', () => {
    assert.equal(
      movieReleaseStage(
        { status: 'Released', releases: releases([3, 90], [4, 10]) },
        NOW
      ),
      'released'
    );
  });

  it('treats old cinema-only listings and missing dates as released', () => {
    assert.equal(
      movieReleaseStage(
        { status: 'Released', releases: releases([3, 400]) },
        NOW
      ),
      'released'
    );
    assert.equal(movieReleaseStage({ status: 'Released' }, NOW), 'released');
  });
});
