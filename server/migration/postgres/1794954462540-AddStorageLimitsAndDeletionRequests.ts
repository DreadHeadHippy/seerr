import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStorageLimitsAndDeletionRequests1794954462540 implements MigrationInterface {
  name = 'AddStorageLimitsAndDeletionRequests1794954462540';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "deletion_request" ("id" SERIAL NOT NULL, "status" integer NOT NULL DEFAULT '1', "seasons" text, "reason" character varying, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "mediaId" integer, "requestedById" integer, "modifiedById" integer, CONSTRAINT "PK_efee984187919e2ea26373a513a" PRIMARY KEY ("id"))`
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
    await queryRunner.query(`ALTER TABLE "user" ADD "storageLimitGb" integer`);
    await queryRunner.query(
      `ALTER TABLE "user" ADD "deletionMode" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "deletion_request" ADD CONSTRAINT "FK_39978b99f5c1f4c43a2dd02ae13" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "deletion_request" ADD CONSTRAINT "FK_1b36f7744ef31dd2c0b2ace6913" FOREIGN KEY ("requestedById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "deletion_request" ADD CONSTRAINT "FK_a791aa9f123b74e0f1e91582ac8" FOREIGN KEY ("modifiedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "deletion_request" DROP CONSTRAINT "FK_a791aa9f123b74e0f1e91582ac8"`
    );
    await queryRunner.query(
      `ALTER TABLE "deletion_request" DROP CONSTRAINT "FK_1b36f7744ef31dd2c0b2ace6913"`
    );
    await queryRunner.query(
      `ALTER TABLE "deletion_request" DROP CONSTRAINT "FK_39978b99f5c1f4c43a2dd02ae13"`
    );
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "deletionMode"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "storageLimitGb"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1b36f7744ef31dd2c0b2ace691"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_39978b99f5c1f4c43a2dd02ae1"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d7df6836fd1779aca1c513d2a9"`
    );
    await queryRunner.query(`DROP TABLE "deletion_request"`);
  }
}
