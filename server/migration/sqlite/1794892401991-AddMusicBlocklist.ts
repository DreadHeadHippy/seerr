import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMusicBlocklist1794892401991 implements MigrationInterface {
  name = 'AddMusicBlocklist1794892401991';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "music_blocklist" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "foreignArtistId" varchar NOT NULL, "artistName" varchar NOT NULL, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "userId" integer, CONSTRAINT "UQ_3193ed8409e71e616868943aa34" UNIQUE ("foreignArtistId"), CONSTRAINT "FK_23bd747dddc4a9e9bc9b3c09c28" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_23bd747dddc4a9e9bc9b3c09c2" ON "music_blocklist" ("userId") `
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_23bd747dddc4a9e9bc9b3c09c2"`);
    await queryRunner.query(`DROP TABLE "music_blocklist"`);
  }
}
