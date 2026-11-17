import { DeletionRequestStatus } from '@server/constants/deletion';
import Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A user asking an admin to delete media they requested: the whole movie,
 * or their seasons of a series.
 */
@Entity()
export class DeletionRequest {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'integer', default: DeletionRequestStatus.PENDING })
  @Index()
  public status: DeletionRequestStatus;

  @ManyToOne(() => Media, { eager: true, onDelete: 'CASCADE' })
  @Index()
  public media: Media;

  @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
  @Index()
  public requestedBy: User;

  @ManyToOne(() => User, { nullable: true, eager: true, onDelete: 'SET NULL' })
  public modifiedBy?: User | null;

  /** Series: the seasons to delete. Empty for a movie. */
  @Column({ type: 'simple-json', nullable: true })
  public seasons?: number[] | null;

  /** Optional note from the user. */
  @Column({ type: 'varchar', nullable: true })
  public reason?: string | null;

  @CreateDateColumn()
  public createdAt: Date;

  @UpdateDateColumn()
  public updatedAt: Date;

  constructor(init?: Partial<DeletionRequest>) {
    Object.assign(this, init);
  }
}

export default DeletionRequest;
