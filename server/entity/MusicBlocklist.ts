import { User } from '@server/entity/User';
import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * Artists hidden from music discovery and search and refused for requests.
 * Separate from the TMDB blocklist, which keys on tmdbId and Media rows that
 * music does not have.
 */
@Entity()
@Unique(['foreignArtistId'])
export class MusicBlocklist {
  @PrimaryGeneratedColumn()
  public id: number;

  /** MusicBrainz artist id, as Lidarr uses it. */
  @Column({ type: 'varchar' })
  public foreignArtistId: string;

  @Column({ type: 'varchar' })
  public artistName: string;

  @ManyToOne(() => User, { eager: true, onDelete: 'SET NULL' })
  @Index()
  public user?: User | null;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  constructor(init?: Partial<MusicBlocklist>) {
    Object.assign(this, init);
  }
}
