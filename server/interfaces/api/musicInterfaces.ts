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
