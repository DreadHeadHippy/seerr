import type {
  LidarrMonitorNewItemsOption,
  LidarrMonitorOption,
} from '@server/api/servarr/lidarr';

/** Something downloading right now, without saying from where. */
export interface MusicDownload {
  /** 0 to 1. */
  progress: number;
  /** Approximate time it is playable in Plex; unknown while queued. */
  readyAt?: string;
}

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
  /** Only set in admin search results; everyone else never sees these. */
  blocklisted?: boolean;
  download?: MusicDownload;
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
  /** MusicBrainz secondary types, e.g. Live, Compilation, Remix. */
  secondaryTypes?: string[];
  coverUrl?: string;
  inLidarr: boolean;
  monitored: boolean;
  hasFiles: boolean;
  lidarrUrl?: string;
  download?: MusicDownload;
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

export interface MusicBlocklistItem {
  id: number;
  foreignArtistId: string;
  artistName: string;
  createdAt: string;
  user?: { id: number; displayName: string; avatar?: string };
}

export interface MusicBlocklistResponse {
  results: MusicBlocklistItem[];
}

export interface MusicBlocklistAddBody {
  foreignArtistId: string;
  artistName: string;
}

export interface MusicArtistDetails {
  artist: MusicArtistResult & {
    links: { name: string; url: string }[];
  };
  /** The artist's official releases, newest first. */
  releases: MusicAlbumResult[];
}
