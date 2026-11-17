import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStorageLimitsAndDeletionRequests1794954462479 implements MigrationInterface {
  name = 'AddStorageLimitsAndDeletionRequests1794954462479';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "deletion_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "status" integer NOT NULL DEFAULT (1), "seasons" text, "reason" varchar, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "mediaId" integer, "requestedById" integer, "modifiedById" integer)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d7df6836fd1779aca1c513d2a9" ON "deletion_request" ("status") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_39978b99f5c1f4c43a2dd02ae1" ON "deletion_request" ("mediaId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1b36f7744ef31dd2c0b2ace691" ON "deletion_request" ("requestedById") `
    );
    await queryRunner.query(
      `CREATE TABLE "temporary_user" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "email" varchar NOT NULL, "username" varchar, "plexId" integer, "plexToken" varchar, "permissions" integer NOT NULL DEFAULT (0), "avatar" varchar NOT NULL, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "password" varchar, "userType" integer NOT NULL DEFAULT (1), "plexUsername" varchar, "resetPasswordGuid" varchar, "recoveryLinkExpirationDate" datetime, "movieQuotaLimit" integer, "movieQuotaDays" integer, "tvQuotaLimit" integer, "tvQuotaDays" integer, "jellyfinUsername" varchar, "jellyfinAuthToken" varchar, "jellyfinUserId" varchar, "jellyfinDeviceId" varchar, "avatarETag" varchar, "avatarVersion" varchar, "storageLimitGb" integer, "deletionMode" varchar, CONSTRAINT "UQ_e12875dfb3b1d92d7d7c5377e22" UNIQUE ("email"))`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_user"("id", "email", "username", "plexId", "plexToken", "permissions", "avatar", "createdAt", "updatedAt", "password", "userType", "plexUsername", "resetPasswordGuid", "recoveryLinkExpirationDate", "movieQuotaLimit", "movieQuotaDays", "tvQuotaLimit", "tvQuotaDays", "jellyfinUsername", "jellyfinAuthToken", "jellyfinUserId", "jellyfinDeviceId", "avatarETag", "avatarVersion") SELECT "id", "email", "username", "plexId", "plexToken", "permissions", "avatar", "createdAt", "updatedAt", "password", "userType", "plexUsername", "resetPasswordGuid", "recoveryLinkExpirationDate", "movieQuotaLimit", "movieQuotaDays", "tvQuotaLimit", "tvQuotaDays", "jellyfinUsername", "jellyfinAuthToken", "jellyfinUserId", "jellyfinDeviceId", "avatarETag", "avatarVersion" FROM "user"`
    );
    await queryRunner.query(`DROP TABLE "user"`);
    await queryRunner.query(`ALTER TABLE "temporary_user" RENAME TO "user"`);
    await queryRunner.query(`DROP INDEX "IDX_d7df6836fd1779aca1c513d2a9"`);
    await queryRunner.query(`DROP INDEX "IDX_39978b99f5c1f4c43a2dd02ae1"`);
    await queryRunner.query(`DROP INDEX "IDX_1b36f7744ef31dd2c0b2ace691"`);
    await queryRunner.query(
      `CREATE TABLE "temporary_deletion_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "status" integer NOT NULL DEFAULT (1), "seasons" text, "reason" varchar, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "mediaId" integer, "requestedById" integer, "modifiedById" integer, CONSTRAINT "FK_39978b99f5c1f4c43a2dd02ae13" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_1b36f7744ef31dd2c0b2ace6913" FOREIGN KEY ("requestedById") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_a791aa9f123b74e0f1e91582ac8" FOREIGN KEY ("modifiedById") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_deletion_request"("id", "status", "seasons", "reason", "createdAt", "updatedAt", "mediaId", "requestedById", "modifiedById") SELECT "id", "status", "seasons", "reason", "createdAt", "updatedAt", "mediaId", "requestedById", "modifiedById" FROM "deletion_request"`
    );
    await queryRunner.query(`DROP TABLE "deletion_request"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_deletion_request" RENAME TO "deletion_request"`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d7df6836fd1779aca1c513d2a9" ON "deletion_request" ("status") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_39978b99f5c1f4c43a2dd02ae1" ON "deletion_request" ("mediaId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1b36f7744ef31dd2c0b2ace691" ON "deletion_request" ("requestedById") `
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_1b36f7744ef31dd2c0b2ace691"`);
    await queryRunner.query(`DROP INDEX "IDX_39978b99f5c1f4c43a2dd02ae1"`);
    await queryRunner.query(`DROP INDEX "IDX_d7df6836fd1779aca1c513d2a9"`);
    await queryRunner.query(
      `ALTER TABLE "deletion_request" RENAME TO "temporary_deletion_request"`
    );
    await queryRunner.query(
      `CREATE TABLE "deletion_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "status" integer NOT NULL DEFAULT (1), "seasons" text, "reason" varchar, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "mediaId" integer, "requestedById" integer, "modifiedById" integer)`
    );
    await queryRunner.query(
      `INSERT INTO "deletion_request"("id", "status", "seasons", "reason", "createdAt", "updatedAt", "mediaId", "requestedById", "modifiedById") SELECT "id", "status", "seasons", "reason", "createdAt", "updatedAt", "mediaId", "requestedById", "modifiedById" FROM "temporary_deletion_request"`
    );
    await queryRunner.query(`DROP TABLE "temporary_deletion_request"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_1b36f7744ef31dd2c0b2ace691" ON "deletion_request" ("requestedById") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_39978b99f5c1f4c43a2dd02ae1" ON "deletion_request" ("mediaId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d7df6836fd1779aca1c513d2a9" ON "deletion_request" ("status") `
    );
    await queryRunner.query(`ALTER TABLE "user" RENAME TO "temporary_user"`);
    await queryRunner.query(
      `CREATE TABLE "user" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "email" varchar NOT NULL, "username" varchar, "plexId" integer, "plexToken" varchar, "permissions" integer NOT NULL DEFAULT (0), "avatar" varchar NOT NULL, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "password" varchar, "userType" integer NOT NULL DEFAULT (1), "plexUsername" varchar, "resetPasswordGuid" varchar, "recoveryLinkExpirationDate" datetime, "movieQuotaLimit" integer, "movieQuotaDays" integer, "tvQuotaLimit" integer, "tvQuotaDays" integer, "jellyfinUsername" varchar, "jellyfinAuthToken" varchar, "jellyfinUserId" varchar, "jellyfinDeviceId" varchar, "avatarETag" varchar, "avatarVersion" varchar, CONSTRAINT "UQ_e12875dfb3b1d92d7d7c5377e22" UNIQUE ("email"))`
    );
    await queryRunner.query(
      `INSERT INTO "user"("id", "email", "username", "plexId", "plexToken", "permissions", "avatar", "createdAt", "updatedAt", "password", "userType", "plexUsername", "resetPasswordGuid", "recoveryLinkExpirationDate", "movieQuotaLimit", "movieQuotaDays", "tvQuotaLimit", "tvQuotaDays", "jellyfinUsername", "jellyfinAuthToken", "jellyfinUserId", "jellyfinDeviceId", "avatarETag", "avatarVersion") SELECT "id", "email", "username", "plexId", "plexToken", "permissions", "avatar", "createdAt", "updatedAt", "password", "userType", "plexUsername", "resetPasswordGuid", "recoveryLinkExpirationDate", "movieQuotaLimit", "movieQuotaDays", "tvQuotaLimit", "tvQuotaDays", "jellyfinUsername", "jellyfinAuthToken", "jellyfinUserId", "jellyfinDeviceId", "avatarETag", "avatarVersion" FROM "temporary_user"`
    );
    await queryRunner.query(`DROP TABLE "temporary_user"`);
    await queryRunner.query(`DROP INDEX "IDX_1b36f7744ef31dd2c0b2ace691"`);
    await queryRunner.query(`DROP INDEX "IDX_39978b99f5c1f4c43a2dd02ae1"`);
    await queryRunner.query(`DROP INDEX "IDX_d7df6836fd1779aca1c513d2a9"`);
    await queryRunner.query(`DROP TABLE "deletion_request"`);
  }
}
