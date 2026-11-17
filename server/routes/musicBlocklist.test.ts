import assert from 'node:assert/strict';
import path from 'node:path';
import { before, describe, it } from 'node:test';

import { getRepository } from '@server/datasource';
import { MusicBlocklist } from '@server/entity/MusicBlocklist';
import { removeBlocklisted } from '@server/lib/musicBlocklist';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import musicRoutes from './music';

const DRAKE = {
  foreignArtistId: '9fff2f8a-21e6-47de-a2b8-7f449929d43f',
  artistName: 'Drake',
};

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
  // The real API validates every request against the spec; so does this.
  app.use(
    OpenApiValidator.middleware({
      apiSpec: path.join(__dirname, '../../seerr-api.yml'),
      validateRequests: true,
      validateSecurity: false,
    })
  );
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/music', musicRoutes);
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

async function loginAs(email: string) {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;

  try {
    const agent = request.agent(app);
    const res = await agent
      .post('/api/v1/auth/local')
      .send({ email, password: 'test1234' });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

describe('music blocklist', () => {
  it('lets an admin blocklist, list and unblock an artist', async () => {
    const admin = await loginAs('admin@seerr.dev');

    const added = await admin.post('/api/v1/music/blocklist').send(DRAKE);
    assert.strictEqual(added.status, 201);

    const duplicate = await admin.post('/api/v1/music/blocklist').send(DRAKE);
    assert.strictEqual(duplicate.status, 412);

    const list = await admin.get('/api/v1/music/blocklist');
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.body.results.length, 1);
    assert.strictEqual(list.body.results[0].artistName, 'Drake');
    assert.strictEqual(list.body.results[0].user.displayName, 'admin');

    const removed = await admin.delete(
      `/api/v1/music/blocklist/${DRAKE.foreignArtistId}`
    );
    assert.strictEqual(removed.status, 204);

    const missing = await admin.delete(
      `/api/v1/music/blocklist/${DRAKE.foreignArtistId}`
    );
    assert.strictEqual(missing.status, 404);
  });

  it('keeps the blocklist admin only', async () => {
    const user = await loginAs('demo@seerr.dev');

    assert.strictEqual((await user.get('/api/v1/music/blocklist')).status, 403);
    assert.strictEqual(
      (await user.post('/api/v1/music/blocklist').send(DRAKE)).status,
      403
    );
    assert.strictEqual(
      (await user.delete(`/api/v1/music/blocklist/${DRAKE.foreignArtistId}`))
        .status,
      403
    );
    assert.strictEqual(await getRepository(MusicBlocklist).count(), 0);
  });

  it('refuses requests for a blocklisted artist', async () => {
    await getRepository(MusicBlocklist).save(new MusicBlocklist(DRAKE));
    const user = await loginAs('demo@seerr.dev');

    const res = await user
      .post('/api/v1/music/artist')
      .send({ foreignArtistId: DRAKE.foreignArtistId });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.message, 'This artist is blocklisted.');
  });

  it('drops blocklisted artists and their albums from rows', () => {
    const blocked = new Set([DRAKE.foreignArtistId]);

    const rows = removeBlocklisted(
      {
        results: [
          { foreignArtistId: DRAKE.foreignArtistId, artistName: 'Drake' },
          { foreignArtistId: 'other', artistName: 'Other' },
          { artistName: 'Album with no artist id' },
        ],
        seeds: [{ foreignArtistId: DRAKE.foreignArtistId }],
        genres: ['hip hop'],
      },
      blocked
    );

    assert.deepStrictEqual(
      rows.results.map((item) => item.artistName),
      ['Other', 'Album with no artist id']
    );
    assert.deepStrictEqual(rows.seeds, []);
    assert.deepStrictEqual(rows.genres, ['hip hop']);
  });
});
