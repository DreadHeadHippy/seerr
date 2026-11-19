import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

import JellyfinAPI from '@server/api/jellyfin';
import { DeletionMode } from '@server/constants/deletion';
import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { UserSettings } from '@server/entity/UserSettings';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { checkUser, isAuthenticated } from '@server/middleware/auth';
import authRoutes from '@server/routes/auth';
import { setupTestDb } from '@server/test/db';
import { permissionsOf, seedManagerAndAdmin } from '@server/test/users';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import userRoutes from '.';
import { storageLimitBodySchema } from './usersettings';

const defaultAuthenticateResponse = {
  User: {
    Id: 'jf-link-user-001',
    Name: 'linkeduser',
    ServerId: 'server-1',
    Policy: { IsAdministrator: false },
  },
  AccessToken: 'fake-qc-access-token',
};

const authenticateQCMock = mock.method(
  JellyfinAPI.prototype,
  'authenticateQuickConnect',
  async () => ({ ...defaultAuthenticateResponse })
);

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(checkUser);
  app.use('/auth', authRoutes);
  app.use('/user', isAuthenticated(), userRoutes);
  app.use('/api/v1/user', isAuthenticated(), userRoutes);
  app.use(
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res
        .status(err.status ?? 500)
        .json({ status: err.status ?? 500, message: err.message });
    }
  );
  return app;
}

before(async () => {
  app = createApp();
});

setupTestDb();

function configureJellyfin() {
  const settings = getSettings();
  settings.main.mediaServerType = MediaServerType.JELLYFIN;
  settings.jellyfin.ip = 'localhost';
  settings.jellyfin.port = 8096;
  settings.jellyfin.useSsl = false;
  settings.jellyfin.urlBase = '';
}

async function loginAs(email: string, password: string) {
  const settings = getSettings();
  settings.main.localLogin = true;

  const agent = request.agent(app);
  const res = await agent.post('/auth/local').send({ email, password });

  assert.strictEqual(res.status, 200);
  return { agent, userId: res.body.id as number };
}

const storageLimitPath = (id: number) =>
  `/api/v1/user/${id}/settings/storage-limit`;

async function createStorageLimitTarget(withSettings = true) {
  const user = await getRepository(User).save(
    new User({
      email: 'quota-target@seerr.dev',
      username: 'quota-target',
      plexUsername: 'plex-quota-target',
      jellyfinUsername: 'jellyfin-quota-target',
      permissions: Permission.REQUEST,
      avatar: 'distinctive-avatar',
      userType: UserType.LOCAL,
      movieQuotaLimit: 17,
      movieQuotaDays: 23,
      tvQuotaLimit: 31,
      tvQuotaDays: 41,
      storageLimitGb: 7,
      deletionMode: DeletionMode.DIRECT,
    })
  );

  if (withSettings) {
    await getRepository(UserSettings).save(
      new UserSettings({
        user,
        locale: 'fr-CA',
        discoverRegion: 'CA',
        streamingRegion: 'GB',
        originalLanguage: 'ja',
        watchlistSyncMovies: true,
        watchlistSyncTv: false,
        pgpKey: 'distinctive-pgp-key',
        discordIds: ['123456789012345'],
        pushbulletAccessToken: 'distinctive-pushbullet-token',
        pushoverApplicationToken: 'distinctive-pushover-app-token',
        pushoverUserKey: 'distinctive-pushover-user-key',
        pushoverSound: 'siren',
        telegramChatId: '-1234567890',
        telegramMessageThreadId: '37',
        telegramSendSilently: true,
        notificationTypes: { email: 123, webpush: 456 },
      })
    );
  }

  return user;
}

async function storageLimitState(id: number) {
  const user = await getRepository(User).findOneOrFail({
    where: { id },
    loadEagerRelations: false,
    select: [
      'id',
      'email',
      'username',
      'plexUsername',
      'jellyfinUsername',
      'permissions',
      'avatar',
      'userType',
      'movieQuotaLimit',
      'movieQuotaDays',
      'tvQuotaLimit',
      'tvQuotaDays',
      'storageLimitGb',
      'deletionMode',
      'createdAt',
      'updatedAt',
    ],
  });
  const settings = await getRepository(UserSettings).findOne({
    where: { user: { id } },
    relations: { user: true },
  });

  if (!settings) {
    return { user, settings: null };
  }

  const { user: settingsUser, ...settingsValues } = settings;

  return {
    user,
    settings: { ...settingsValues, userId: settingsUser.id },
  };
}

describe('POST /api/v1/user/:id/settings/storage-limit', () => {
  it('sets, changes, and repeats a positive quota without changing other state', async () => {
    const target = await createStorageLimitTarget();
    const before = await storageLimitState(target.id);
    const { agent } = await loginAs('admin@seerr.dev', 'test1234');

    for (const storageLimitGb of [100, 200, 1_048_576, 1_048_576]) {
      const res = await agent
        .post(storageLimitPath(target.id))
        .send({ storageLimitGb });

      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(res.body, {
        id: target.id,
        storageLimitGb,
      });

      const after = await storageLimitState(target.id);
      assert.strictEqual(after.user.storageLimitGb, storageLimitGb);
      assert.strictEqual(
        after.user.updatedAt.getTime(),
        before.user.updatedAt.getTime()
      );
      assert.deepStrictEqual(after.settings, before.settings);
      assert.deepStrictEqual(
        { ...after.user, storageLimitGb: before.user.storageLimitGb },
        { ...before.user }
      );
    }
  });

  it('sets zero as explicitly unlimited', async () => {
    const target = await createStorageLimitTarget();
    const { agent } = await loginAs('admin@seerr.dev', 'test1234');

    const res = await agent
      .post(storageLimitPath(target.id))
      .send({ storageLimitGb: 0 });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { id: target.id, storageLimitGb: 0 });
    assert.strictEqual(
      (await getRepository(User).findOneOrFail({ where: { id: target.id } }))
        .storageLimitGb,
      0
    );
  });

  it('sets null to inherit the global default', async () => {
    const target = await createStorageLimitTarget();
    const { agent } = await loginAs('admin@seerr.dev', 'test1234');

    const res = await agent
      .post(storageLimitPath(target.id))
      .send({ storageLimitGb: null });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, {
      id: target.id,
      storageLimitGb: null,
    });
    assert.strictEqual(
      (await getRepository(User).findOneOrFail({ where: { id: target.id } }))
        .storageLimitGb,
      null
    );
  });

  it('does not create UserSettings when the target has none', async () => {
    const target = await createStorageLimitTarget(false);
    const { agent } = await loginAs('admin@seerr.dev', 'test1234');

    const res = await agent
      .post(storageLimitPath(target.id))
      .send({ storageLimitGb: 25 });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(
      await getRepository(UserSettings).count({
        where: { user: { id: target.id } },
      }),
      0
    );
  });

  it('rejects invalid quota values and unknown properties without changing state', async () => {
    const target = await createStorageLimitTarget();
    const before = await storageLimitState(target.id);
    const { agent } = await loginAs('admin@seerr.dev', 'test1234');
    const invalidBodies = [
      { storageLimitGb: -1 },
      { storageLimitGb: 1.5 },
      { storageLimitGb: '100' },
      {},
      { storageLimitGb: 1_048_577 },
      { storageLimitGb: 100, unrelated: true },
    ];

    for (const body of invalidBodies) {
      const res = await agent.post(storageLimitPath(target.id)).send(body);

      assert.strictEqual(res.status, 400);
      assert.deepStrictEqual(await storageLimitState(target.id), before);
    }

    assert.strictEqual(
      storageLimitBodySchema.safeParse({ storageLimitGb: undefined }).success,
      false
    );
    assert.strictEqual(
      storageLimitBodySchema.safeParse({ storageLimitGb: Number.NaN }).success,
      false
    );
    assert.strictEqual(
      storageLimitBodySchema.safeParse({
        storageLimitGb: Number.POSITIVE_INFINITY,
      }).success,
      false
    );
  });

  it('rejects malformed JSON without changing state', async () => {
    const target = await createStorageLimitTarget();
    const before = await storageLimitState(target.id);
    const { agent } = await loginAs('admin@seerr.dev', 'test1234');

    const res = await agent
      .post(storageLimitPath(target.id))
      .set('Content-Type', 'application/json')
      .send('{"storageLimitGb":');

    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(await storageLimitState(target.id), before);
  });

  it('rejects an invalid user ID and returns 404 for a missing user', async () => {
    const { agent } = await loginAs('admin@seerr.dev', 'test1234');

    const invalidId = await agent
      .post('/api/v1/user/not-an-id/settings/storage-limit')
      .send({ storageLimitGb: 25 });
    const missingUser = await agent
      .post('/api/v1/user/999999/settings/storage-limit')
      .send({ storageLimitGb: 25 });

    assert.strictEqual(invalidId.status, 400);
    assert.strictEqual(missingUser.status, 404);
  });

  it('rejects unauthenticated requests without changing the target', async () => {
    const target = await createStorageLimitTarget();
    const before = await storageLimitState(target.id);

    const res = await request(app)
      .post(storageLimitPath(target.id))
      .send({ storageLimitGb: 25 });

    assert.strictEqual(res.status, 403);
    assert.deepStrictEqual(await storageLimitState(target.id), before);
  });

  it('rejects a non-admin without MANAGE_USERS', async () => {
    const target = await createStorageLimitTarget();
    const before = await storageLimitState(target.id);
    const { agent } = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent
      .post(storageLimitPath(target.id))
      .send({ storageLimitGb: 25 });

    assert.strictEqual(res.status, 403);
    assert.deepStrictEqual(await storageLimitState(target.id), before);
  });

  it('rejects an authenticated user without MANAGE_USERS', async () => {
    const target = await createStorageLimitTarget();
    const before = await storageLimitState(target.id);
    const actor = await getRepository(User).save(
      new User({
        email: 'settings-manager@seerr.dev',
        username: 'settings-manager',
        permissions: Permission.MANAGE_SETTINGS,
        avatar: '',
        userType: UserType.LOCAL,
      })
    );
    await actor.setPassword('test1234');
    await getRepository(User).save(actor);
    const { agent } = await loginAs('settings-manager@seerr.dev', 'test1234');

    const res = await agent
      .post(storageLimitPath(target.id))
      .send({ storageLimitGb: 25 });

    assert.strictEqual(res.status, 403);
    assert.deepStrictEqual(await storageLimitState(target.id), before);
  });

  it("rejects changing the authenticated administrator's own quota", async () => {
    const { agent, userId } = await loginAs('admin@seerr.dev', 'test1234');
    const before = await storageLimitState(userId);

    const res = await agent
      .post(storageLimitPath(userId))
      .send({ storageLimitGb: 25 });

    assert.strictEqual(res.status, 403);
    assert.deepStrictEqual(await storageLimitState(userId), before);
  });

  it("rejects changing another administrator's quota, even by the owner", async () => {
    const { otherAdmin } = await seedManagerAndAdmin();
    otherAdmin.storageLimitGb = 14;
    await getRepository(User).save(otherAdmin);
    const before = await storageLimitState(otherAdmin.id);
    const { agent } = await loginAs('admin@seerr.dev', 'test1234');

    const res = await agent
      .post(storageLimitPath(otherAdmin.id))
      .send({ storageLimitGb: 25 });

    assert.strictEqual(res.status, 403);
    assert.deepStrictEqual(await storageLimitState(otherAdmin.id), before);
  });

  it('rejects a non-admin MANAGE_USERS target (privileged targets are unlimited)', async () => {
    const manager = await getRepository(User).save(
      new User({
        email: 'quota-manager-target@seerr.dev',
        username: 'quota-manager-target',
        permissions: Permission.MANAGE_USERS,
        avatar: '',
        userType: UserType.LOCAL,
        storageLimitGb: 9,
      })
    );
    const before = await storageLimitState(manager.id);
    const { agent } = await loginAs('admin@seerr.dev', 'test1234');

    const res = await agent
      .post(storageLimitPath(manager.id))
      .send({ storageLimitGb: 25 });

    assert.strictEqual(res.status, 403);
    assert.deepStrictEqual(await storageLimitState(manager.id), before);
  });

  it('uses the existing canModifyUser rule for manager access', async () => {
    const { otherAdmin } = await seedManagerAndAdmin();
    const target = await createStorageLimitTarget();
    const before = await storageLimitState(target.id);
    const { agent } = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent
      .post(storageLimitPath(target.id))
      .send({ storageLimitGb: 25 });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(
      (await getRepository(User).findOneOrFail({ where: { id: target.id } }))
        .storageLimitGb,
      25
    );
    assert.strictEqual(
      (
        await getRepository(User).findOneOrFail({
          where: { id: otherAdmin.id },
        })
      ).storageLimitGb,
      null
    );
    assert.deepStrictEqual(
      (await storageLimitState(target.id)).settings,
      before.settings
    );
  });
});

describe('POST /user/:id/settings/linked-accounts/jellyfin/quickconnect', () => {
  beforeEach(() => {
    authenticateQCMock.mock.resetCalls();
    authenticateQCMock.mock.mockImplementation(async () => ({
      ...defaultAuthenticateResponse,
    }));
    configureJellyfin();
  });

  it('links the account when the media server is Jellyfin', async () => {
    const { agent, userId } = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent
      .post(`/user/${userId}/settings/linked-accounts/jellyfin/quickconnect`)
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 204);
    assert.strictEqual(authenticateQCMock.mock.callCount(), 1);

    const user = await getRepository(User).findOneOrFail({
      where: { id: userId },
    });
    assert.strictEqual(user.jellyfinUserId, 'jf-link-user-001');
    assert.strictEqual(user.userType, UserType.JELLYFIN);
  });

  it('returns 403 when the media server is Emby', async () => {
    const { agent, userId } = await loginAs('demo@seerr.dev', 'test1234');
    getSettings().main.mediaServerType = MediaServerType.EMBY;

    const res = await agent
      .post(`/user/${userId}/settings/linked-accounts/jellyfin/quickconnect`)
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(authenticateQCMock.mock.callCount(), 0);

    const user = await getRepository(User).findOneOrFail({
      where: { id: userId },
    });
    assert.strictEqual(user.jellyfinUserId, null);
  });
});

describe('POST /user/:id/settings/permissions', () => {
  it('stops a manager from removing admin from another admin', async () => {
    const { otherAdmin } = await seedManagerAndAdmin();
    const { agent } = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent
      .post(`/user/${otherAdmin.id}/settings/permissions`)
      .send({ permissions: Permission.REQUEST });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(await permissionsOf(otherAdmin.id), Permission.ADMIN);
  });
});

describe('POST /user/:id/settings/main', () => {
  it("stops a manager from changing an admin's email", async () => {
    const { otherAdmin } = await seedManagerAndAdmin();
    const { agent } = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent
      .post(`/user/${otherAdmin.id}/settings/main`)
      .send({ username: 'admin2', email: 'new@example.com' });

    assert.strictEqual(res.status, 403);
    const user = await getRepository(User).findOneOrFail({
      where: { id: otherAdmin.id },
    });
    assert.strictEqual(user.email, 'admin2@seerr.dev');
  });

  it("lets the owner change an admin's email", async () => {
    const { otherAdmin } = await seedManagerAndAdmin();
    const { agent } = await loginAs('admin@seerr.dev', 'test1234');

    const res = await agent
      .post(`/user/${otherAdmin.id}/settings/main`)
      .send({ username: 'admin2', email: 'new@example.com' });

    assert.strictEqual(res.status, 200);
    const user = await getRepository(User).findOneOrFail({
      where: { id: otherAdmin.id },
    });
    assert.strictEqual(user.email, 'new@example.com');
  });
});

describe('POST /user/:id/settings/password', () => {
  async function passwordUnchanged(userId: number) {
    const user = await getRepository(User).findOneOrFail({
      select: ['id', 'password'],
      where: { id: userId },
    });
    return user.passwordMatch('test1234');
  }

  it('rejects a wrong current password', async () => {
    const { agent, userId } = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent
      .post(`/user/${userId}/settings/password`)
      .send({ currentPassword: 'wrong-password', newPassword: 'new-password' });

    assert.strictEqual(res.status, 403);
    assert.ok(await passwordUnchanged(userId));
  });

  it('rejects a missing current password', async () => {
    const { agent, userId } = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent
      .post(`/user/${userId}/settings/password`)
      .send({ newPassword: 'new-password' });

    assert.strictEqual(res.status, 403);
    assert.ok(await passwordUnchanged(userId));
  });

  it('stops a manager from demoting an admin to reset their password', async () => {
    const { otherAdmin } = await seedManagerAndAdmin();
    const { agent } = await loginAs('demo@seerr.dev', 'test1234');

    const demote = await agent
      .post(`/user/${otherAdmin.id}/settings/permissions`)
      .send({ permissions: Permission.REQUEST });
    const reset = await agent
      .post(`/user/${otherAdmin.id}/settings/password`)
      .send({ newPassword: 'takeover1234' });

    assert.strictEqual(demote.status, 403);
    assert.strictEqual(reset.status, 403);
    const user = await getRepository(User).findOneOrFail({
      select: ['id', 'password'],
      where: { id: otherAdmin.id },
    });
    assert.ok(!user.password);
  });

  it('lets the owner demote an admin and reset their password', async () => {
    const { otherAdmin } = await seedManagerAndAdmin();
    const { agent } = await loginAs('admin@seerr.dev', 'test1234');

    const demote = await agent
      .post(`/user/${otherAdmin.id}/settings/permissions`)
      .send({ permissions: Permission.REQUEST });
    const reset = await agent
      .post(`/user/${otherAdmin.id}/settings/password`)
      .send({ newPassword: 'reset12345' });

    assert.strictEqual(demote.status, 200);
    assert.strictEqual(reset.status, 204);
    const user = await getRepository(User).findOneOrFail({
      select: ['id', 'password'],
      where: { id: otherAdmin.id },
    });
    assert.ok(await user.passwordMatch('reset12345'));
  });
});
