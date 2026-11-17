import type {
  LidarrMonitorNewItemsOption,
  LidarrMonitorOption,
} from '@server/api/servarr/lidarr';

export interface MusicArtistResult {
  foreignArtistId: string;
  artistName: string;
  disambiguation?: string;
  overview?: string;
  artistType?: string;
  genres: string[];
  posterUrl?: string;
  fanartUrl?: string;
  inLidarr: boolean;
  monitored: boolean;
  albumCount?: number;
  trackFileCount?: number;
  lidarrUrl?: string;
}

export interface MusicSearchResponse {
  results: MusicArtistResult[];
}

export interface MusicArtistAddBody {
  foreignArtistId: string;
  monitor?: LidarrMonitorOption;
  monitorNewItems?: LidarrMonitorNewItemsOption;
  serverId?: number;
  profileId?: number;
  metadataProfileId?: number;
  rootFolder?: string;
  tags?: number[];
}

export interface MusicAlbumResult {
  foreignAlbumId: string;
  title: string;
  albumType: string;
  artistName: string;
  foreignArtistId?: string;
  releaseDate: string;
  coverUrl?: string;
  inLidarr: boolean;
  monitored: boolean;
  hasFiles: boolean;
  lidarrUrl?: string;
}

export interface MusicAlbumsResponse {
  results: MusicAlbumResult[];
}

export interface MusicAlbumAddBody {
  foreignAlbumId: string;
  serverId?: number;
  profileId?: number;
  metadataProfileId?: number;
  rootFolder?: string;
  tags?: number[];
}

export interface MusicPersonalResponse {
  /** Library artists for the "Because you like" rows. */
  seeds: { foreignArtistId: string; artistName: string }[];
  /** The library's most common genres, for the "More {genre}" rows. */
  genres: string[];
}

export interface MusicPreviewTrack {
  id: number;
  title: string;
  albumTitle?: string;
  coverUrl?: string;
  /** A 30 second clip. The url is signed and expires after a while. */
  previewUrl: string;
}

export interface MusicPreviewResponse {
  tracks: MusicPreviewTrack[];
}
