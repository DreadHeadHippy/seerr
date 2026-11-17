/**
 * What a user may do with media they requested:
 * - none: nothing
 * - request: ask an admin to delete it
 * - direct: delete it themselves
 */
export enum DeletionMode {
  NONE = 'none',
  REQUEST = 'request',
  DIRECT = 'direct',
}

export enum DeletionRequestStatus {
  PENDING = 1,
  APPROVED,
  DECLINED,
  /** Approved, but deleting from Radarr/Sonarr failed. */
  FAILED,
}
