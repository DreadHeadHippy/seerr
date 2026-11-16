import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Permission } from '@server/lib/permissions';
import { permissionsForLibraryTypes } from '@server/lib/plexPermissionSync';

describe('permissionsForLibraryTypes', () => {
  it('grants only music requests for a music-only user', () => {
    const result = permissionsForLibraryTypes(
      Permission.REQUEST,
      new Set(['artist'])
    );

    assert.equal(result, Permission.REQUEST_MUSIC);
  });

  it('grants each request type for the shared library types', () => {
    const result = permissionsForLibraryTypes(
      0,
      new Set(['movie', 'show', 'artist', 'photo'])
    );

    assert.equal(
      result,
      Permission.REQUEST_MOVIE |
        Permission.REQUEST_TV |
        Permission.REQUEST_MUSIC
    );
  });

  it('removes request permissions when no media libraries are shared', () => {
    const result = permissionsForLibraryTypes(
      Permission.REQUEST_MOVIE | Permission.REQUEST_TV,
      new Set(['photo'])
    );

    assert.equal(result, 0);
  });

  it('keeps unrelated permissions untouched', () => {
    const other =
      Permission.VOTE | Permission.CREATE_ISSUES | Permission.AUTO_APPROVE;
    const result = permissionsForLibraryTypes(
      other | Permission.REQUEST,
      new Set(['movie'])
    );

    assert.equal(result, other | Permission.REQUEST_MOVIE);
  });

  it('removes 4K permissions for media types the user cannot access', () => {
    const result = permissionsForLibraryTypes(
      Permission.REQUEST_4K |
        Permission.REQUEST_4K_MOVIE |
        Permission.REQUEST_4K_TV,
      new Set(['movie'])
    );

    assert.equal(
      result,
      Permission.REQUEST_MOVIE | Permission.REQUEST_4K_MOVIE
    );
  });
});
