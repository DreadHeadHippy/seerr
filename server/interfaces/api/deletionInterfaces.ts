import type {
  DeletionMode,
  DeletionRequestStatus,
} from '@server/constants/deletion';
import type Media from '@server/entity/Media';
import type { User } from '@server/entity/User';
import type { Ownership } from '@server/lib/deletion';

/** A deletion request as sent to the browser: users without private fields. */
export interface SerializedDeletionRequest {
  id: number;
  status: DeletionRequestStatus;
  media: Media;
  requestedBy: Partial<User>;
  modifiedBy: Partial<User> | null;
  seasons?: number[] | null;
  reason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** What the current user can do about deleting a title. */
export interface DeletionOptions extends Ownership {
  mode: DeletionMode;
  /** Their pending request for this title, if any. */
  pending?: SerializedDeletionRequest | null;
}
