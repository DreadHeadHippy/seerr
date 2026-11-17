import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMusicBlocklist1794892402051 implements MigrationInterface {
  name = 'AddMusicBlocklist1794892402051';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "music_blocklist" ("id" SERIAL NOT NULL, "foreignArtistId" character varying NOT NULL, "artistName" character varying NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "userId" integer, CONSTRAINT "UQ_3193ed8409e71e616868943aa34" UNIQUE ("foreignArtistId"), CONSTRAINT "PK_612e6f16d90483492db2e104750" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_23bd747dddc4a9e9bc9b3c09c2" ON "music_blocklist" ("userId") `
    );
    await queryRunner.query(
      `ALTER TABLE "music_blocklist" ADD CONSTRAINT "FK_23bd747dddc4a9e9bc9b3c09c28" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "music_blocklist" DROP CONSTRAINT "FK_23bd747dddc4a9e9bc9b3c09c28"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_23bd747dddc4a9e9bc9b3c09c2"`
    );
    await queryRunner.query(`DROP TABLE "music_blocklist"`);
  }
}
