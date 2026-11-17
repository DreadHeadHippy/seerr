import LidarrAPI from '@server/api/servarr/lidarr';
import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import { MediaType } from '@server/constants/media';
import type { ArrGrab, ArrService } from '@server/lib/arrWebhook';
import {
  fetchLiveProgress,
  isLiveTrackingEnabled,
  type LiveProgress,
} from '@server/lib/liveDownloads';
import {
  IMPORTED_SCAN_DELAY_MS,
  anyDownloadLeft,
  scanMediaServerSoon,
} from '@server/lib/scanSoon';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { uniqWith } from 'lodash';

interface EpisodeNumberResult {
  seasonNumber: number;
  episodeNumber: number;
  absoluteEpisodeNumber: number;
  id: number;
}
export interface DownloadingItem {
  mediaType: MediaType;
  externalId: number;
  size: number;
  sizeLeft: number;
  status: string;
  timeLeft: string;
  /** Missing when there is no estimate (queued, paused, stalled). */
  estimatedCompletionTime?: Date;
  title: string;
  downloadId: string;
  episode?: EpisodeNumberResult;
}

/** A grab an *arr announced by webhook, kept until its queue catches up. */
export interface TrackedGrab extends ArrGrab {
  service: ArrService;
  serverId: number;
  at: number;
}

interface Owner {
  service: ArrService;
  serverId: number;
}

/** A webhook grab that never shows up in the queue is dropped after this. */
const GRAB_TTL_MS = 15 * 60 * 1000;

/** After asking an *arr to import, re-read the queues this much later. */
const RESYNC_AFTER_NUDGE_MS = 20 * 1000;

const lower = (hash: string | undefined): string => hash?.toLowerCase() ?? '';

class DownloadTracker {
  private radarrServers: Record<number, DownloadingItem[]> = {};
  private sonarrServers: Record<number, DownloadingItem[]> = {};
  /** Torrent hashes in each Lidarr queue, lowercase. */
  private lidarrServers: Record<number, string[]> = {};
  /** Webhook grabs by lowercase torrent hash. */
  private grabs = new Map<string, TrackedGrab>();
  /** Live qBittorrent progress by lowercase torrent hash. */
  private live = new Map<string, LiveProgress>();
  /** Finished torrents whose *arr we already asked to import. */
  private nudged = new Set<string>();
  private resyncTimer?: ReturnType<typeof setTimeout>;
  private warnedNoQbit = false;

  /**
   * The *arr queue's numbers, replaced by qBittorrent's live ones when the
   * download is one of its torrents.
   */
  private withLive(items: DownloadingItem[]): DownloadingItem[] {
    if (this.live.size === 0) {
      return items;
    }

    return items.map((item) => {
      const live = item.downloadId
        ? this.live.get(lower(item.downloadId))
        : undefined;

      return live ? { ...item, ...live } : item;
    });
  }

  private grabsFor(service: ArrService, serverId: number): TrackedGrab[] {
    return [...this.grabs.values()].filter(
      (grab) => grab.service === service && grab.serverId === serverId
    );
  }

  /** The queue, plus webhook grabs it hasn't caught up with yet. */
  private withGrabs(
    service: ArrService,
    serverId: number,
    queue: DownloadingItem[] = []
  ): DownloadingItem[] {
    const queued = new Set(queue.map((item) => lower(item.downloadId)));
    const pending = this.grabsFor(service, serverId)
      .filter((grab) => !queued.has(grab.downloadId))
      .flatMap((grab) => grab.items);

    return pending.length ? [...queue, ...pending] : queue;
  }

  public getMovieProgress(
    serverId: number,
    externalServiceId: number
  ): DownloadingItem[] {
    return this.withLive(
      this.withGrabs('radarr', serverId, this.radarrServers[serverId]).filter(
        (item) => item.externalId === externalServiceId
      )
    );
  }

  public getSeriesProgress(
    serverId: number,
    externalServiceId: number
  ): DownloadingItem[] {
    return this.withLive(
      this.withGrabs('sonarr', serverId, this.sonarrServers[serverId]).filter(
        (item) => item.externalId === externalServiceId
      )
    );
  }

  /** Lidarr grabs, for the Music pages to show before its queue catches up. */
  public getLidarrGrabs(): TrackedGrab[] {
    return [...this.grabs.values()].filter((grab) => grab.service === 'lidarr');
  }

  /** An *arr grabbed something: track it now, not when its queue updates. */
  public async addGrab(grab: TrackedGrab) {
    this.grabs.set(grab.downloadId, grab);
    // If the torrent isn't in qBittorrent yet, the 10 second live loop
    // picks it up when it is.
    await this.updateLiveProgress();
  }

  /** An *arr imported a download: stop tracking it and look for it. */
  public markImported(
    service: ArrService,
    serverId: number,
    downloadId?: string
  ) {
    const hash = lower(downloadId);

    if (hash) {
      this.grabs.delete(hash);

      if (service === 'radarr' && this.radarrServers[serverId]) {
        this.radarrServers[serverId] = this.radarrServers[serverId].filter(
          (item) => lower(item.downloadId) !== hash
        );
      } else if (service === 'sonarr' && this.sonarrServers[serverId]) {
        this.sonarrServers[serverId] = this.sonarrServers[serverId].filter(
          (item) => lower(item.downloadId) !== hash
        );
      } else if (service === 'lidarr' && this.lidarrServers[serverId]) {
        this.lidarrServers[serverId] = this.lidarrServers[serverId].filter(
          (h) => h !== hash
        );
      }
    }

    // Seerr doesn't track music availability; Lidarr tells Plex itself.
    if (service !== 'lidarr') {
      scanMediaServerSoon(IMPORTED_SCAN_DELAY_MS);
    }
  }

  public async resetDownloadTracker() {
    this.radarrServers = {};
    this.sonarrServers = {};
    this.lidarrServers = {};
    this.grabs = new Map();
    this.live = new Map();
    this.nudged = new Set();
  }

  public async updateDownloads() {
    await Promise.all([
      this.updateRadarrDownloads(),
      this.updateSonarrDownloads(),
      this.updateLidarrDownloads(),
    ]);
    this.pruneGrabs();
    // New downloads get live numbers right away, not on the next tick.
    await this.updateLiveProgress();
  }

  /** Drops grabs the queue now shows, and ones that never turned up. */
  private pruneGrabs() {
    const now = Date.now();
    const queued = (grab: TrackedGrab): boolean => {
      if (grab.service === 'lidarr') {
        return !!this.lidarrServers[grab.serverId]?.includes(grab.downloadId);
      }

      const queue =
        grab.service === 'radarr'
          ? this.radarrServers[grab.serverId]
          : this.sonarrServers[grab.serverId];

      return !!queue?.some(
        (item) => lower(item.downloadId) === grab.downloadId
      );
    };

    for (const [hash, grab] of this.grabs) {
      if (queued(grab) || now - grab.at > GRAB_TTL_MS) {
        this.grabs.delete(hash);
      }
    }
  }

  /**
   * Re-reads progress for every tracked download from qBittorrent. Cheap, so
   * it runs every few seconds; the *arr queues only refresh from their
   * download client about once a minute.
   */
  public async updateLiveProgress() {
    const hashes = [
      ...[
        ...Object.values(this.radarrServers),
        ...Object.values(this.sonarrServers),
      ].flatMap((items) => items.map((item) => item.downloadId)),
      ...Object.values(this.lidarrServers).flat(),
      ...this.grabs.keys(),
    ];

    if (!isLiveTrackingEnabled()) {
      if (hashes.some(Boolean) && !this.warnedNoQbit) {
        this.warnedNoQbit = true;
        logger.warn(
          'Downloads are being tracked but qBittorrent is not set up (Settings → Services), so progress lags the *arr queues',
          { label: 'Download Tracker' }
        );
      }

      this.live = new Map();
      return;
    }

    this.warnedNoQbit = false;
    this.live = await fetchLiveProgress(hashes);
    this.nudgeFinished();
  }

  /** Which *arr server each tracked torrent belongs to. */
  private owners(): Map<string, Owner> {
    const owners = new Map<string, Owner>();
    const addItems = (
      service: ArrService,
      servers: Record<number, DownloadingItem[]>
    ) => {
      for (const [serverId, items] of Object.entries(servers)) {
        for (const item of items) {
          owners.set(lower(item.downloadId), {
            service,
            serverId: Number(serverId),
          });
        }
      }
    };

    addItems('radarr', this.radarrServers);
    addItems('sonarr', this.sonarrServers);

    for (const [serverId, hashes] of Object.entries(this.lidarrServers)) {
      for (const hash of hashes) {
        owners.set(hash, { service: 'lidarr', serverId: Number(serverId) });
      }
    }

    for (const grab of this.grabs.values()) {
      owners.set(grab.downloadId, grab);
    }

    owners.delete('');
    return owners;
  }

  /**
   * qBittorrent finished some torrents: tell their *arr to check now rather
   * than on its own once-a-minute pass, so the import starts in seconds.
   */
  private nudgeFinished() {
    const owners = this.owners();
    const servers = new Map<string, Owner>();

    for (const [hash, live] of this.live) {
      if (live.status !== 'completed' || this.nudged.has(hash)) {
        continue;
      }

      this.nudged.add(hash);
      const owner = owners.get(hash);

      if (owner) {
        servers.set(`${owner.service}:${owner.serverId}`, owner);
      }
    }

    // Forget torrents we no longer track, so the set doesn't grow forever.
    for (const hash of this.nudged) {
      if (!this.live.has(hash)) {
        this.nudged.delete(hash);
      }
    }

    if (servers.size === 0) {
      return;
    }

    for (const { service, serverId } of servers.values()) {
      this.createClient(service, serverId)
        ?.refreshMonitoredDownloads()
        .then(() =>
          logger.debug(
            `A download finished; asked ${service} server ${serverId} to import it`,
            { label: 'Download Tracker' }
          )
        )
        .catch((e) =>
          logger.debug(`Unable to ask ${service} to import a download`, {
            label: 'Download Tracker',
            errorMessage: e.message,
          })
        );
    }

    // Without webhooks, this is how we notice the import happened.
    if (!this.resyncTimer) {
      this.resyncTimer = setTimeout(() => {
        this.resyncTimer = undefined;
        this.updateDownloads();
      }, RESYNC_AFTER_NUDGE_MS);
    }
  }

  private createClient(
    service: ArrService,
    serverId: number
  ): RadarrAPI | SonarrAPI | LidarrAPI | undefined {
    const settings = getSettings();

    if (service === 'radarr') {
      const server = settings.radarr.find((s) => s.id === serverId);

      return server
        ? new RadarrAPI({
            apiKey: server.apiKey,
            url: RadarrAPI.buildUrl(server, '/api/v3'),
          })
        : undefined;
    }

    if (service === 'sonarr') {
      const server = settings.sonarr.find((s) => s.id === serverId);

      return server
        ? new SonarrAPI({
            apiKey: server.apiKey,
            url: SonarrAPI.buildUrl(server, '/api/v3'),
          })
        : undefined;
    }

    const server = settings.lidarr.find((s) => s.id === serverId);

    return server
      ? new LidarrAPI({
          apiKey: server.apiKey,
          url: LidarrAPI.buildUrl(server, '/api/v1'),
        })
      : undefined;
  }

  /** Lidarr's queue hashes, so finished music downloads get nudged too. */
  private async updateLidarrDownloads() {
    await Promise.all(
      getSettings().lidarr.map(async (server) => {
        const lidarr = this.createClient('lidarr', server.id) as LidarrAPI;

        try {
          const queue = await lidarr.getDownloadQueue();
          this.lidarrServers[server.id] = queue
            .map((item) => lower(item.downloadId))
            .filter(Boolean);
        } catch {
          logger.debug(
            `Unable to get queue from Lidarr server: ${server.name}`,
            { label: 'Download Tracker' }
          );
        }
      })
    );
  }

  private async updateRadarrDownloads() {
    const settings = getSettings();

    // Remove duplicate servers
    const filteredServers = uniqWith(settings.radarr, (radarrA, radarrB) => {
      return (
        radarrA.hostname === radarrB.hostname &&
        radarrA.port === radarrB.port &&
        radarrA.baseUrl === radarrB.baseUrl
      );
    });

    // Load downloads from Radarr servers, Enable Scan or not: Enable Scan is
    // about availability, and requesters should always see progress
    await Promise.all(
      filteredServers.map(async (server) => {
        const radarr = new RadarrAPI({
          apiKey: server.apiKey,
          url: RadarrAPI.buildUrl(server, '/api/v3'),
        });

        try {
          await radarr.refreshMonitoredDownloads();
          const queueItems = await radarr.getQueue();

          if (
            anyDownloadLeft(
              this.radarrServers[server.id],
              queueItems.map((item) => item.downloadId)
            )
          ) {
            scanMediaServerSoon();
          }

          this.radarrServers[server.id] = queueItems.map((item) => ({
            externalId: item.movieId,
            estimatedCompletionTime: new Date(item.estimatedCompletionTime),
            mediaType: MediaType.MOVIE,
            size: item.size,
            sizeLeft: item.sizeleft,
            status: item.status,
            timeLeft: item.timeleft,
            title: item.title,
            downloadId: item.downloadId,
          }));

          if (queueItems.length > 0) {
            logger.debug(
              `Found ${queueItems.length} item(s) in progress on Radarr server: ${server.name}`,
              { label: 'Download Tracker' }
            );
          }
        } catch {
          logger.error(
            `Unable to get queue from Radarr server: ${server.name}`,
            {
              label: 'Download Tracker',
            }
          );
        }

        // Duplicate this data to matching servers
        const matchingServers = settings.radarr.filter(
          (rs) =>
            rs.hostname === server.hostname &&
            rs.port === server.port &&
            rs.baseUrl === server.baseUrl &&
            rs.id !== server.id
        );

        if (matchingServers.length > 0) {
          logger.debug(
            `Matching download data to ${matchingServers.length} other Radarr server(s)`,
            { label: 'Download Tracker' }
          );
        }

        matchingServers.forEach((ms) => {
          this.radarrServers[ms.id] = this.radarrServers[server.id];
        });
      })
    );
  }

  private async updateSonarrDownloads() {
    const settings = getSettings();

    // Remove duplicate servers
    const filteredServers = uniqWith(settings.sonarr, (sonarrA, sonarrB) => {
      return (
        sonarrA.hostname === sonarrB.hostname &&
        sonarrA.port === sonarrB.port &&
        sonarrA.baseUrl === sonarrB.baseUrl
      );
    });

    // Load downloads from Sonarr servers, Enable Scan or not: Enable Scan is
    // about availability, and requesters should always see progress
    await Promise.all(
      filteredServers.map(async (server) => {
        const sonarr = new SonarrAPI({
          apiKey: server.apiKey,
          url: SonarrAPI.buildUrl(server, '/api/v3'),
        });

        try {
          await sonarr.refreshMonitoredDownloads();
          const queueItems = await sonarr.getQueue();

          if (
            anyDownloadLeft(
              this.sonarrServers[server.id],
              queueItems.map((item) => item.downloadId)
            )
          ) {
            scanMediaServerSoon();
          }

          this.sonarrServers[server.id] = queueItems.map((item) => ({
            externalId: item.seriesId,
            estimatedCompletionTime: new Date(item.estimatedCompletionTime),
            mediaType: MediaType.TV,
            size: item.size,
            sizeLeft: item.sizeleft,
            status: item.status,
            timeLeft: item.timeleft,
            title: item.title,
            episode: item.episode,
            downloadId: item.downloadId,
          }));

          if (queueItems.length > 0) {
            logger.debug(
              `Found ${queueItems.length} item(s) in progress on Sonarr server: ${server.name}`,
              { label: 'Download Tracker' }
            );
          }
        } catch {
          logger.error(
            `Unable to get queue from Sonarr server: ${server.name}`,
            {
              label: 'Download Tracker',
            }
          );
        }

        // Duplicate this data to matching servers
        const matchingServers = settings.sonarr.filter(
          (ss) =>
            ss.hostname === server.hostname &&
            ss.port === server.port &&
            ss.baseUrl === server.baseUrl &&
            ss.id !== server.id
        );

        if (matchingServers.length > 0) {
          logger.debug(
            `Matching download data to ${matchingServers.length} other Sonarr server(s)`,
            { label: 'Download Tracker' }
          );
        }

        matchingServers.forEach((ms) => {
          this.sonarrServers[ms.id] = this.sonarrServers[server.id];
        });
      })
    );
  }
}

const downloadTracker = new DownloadTracker();

export default downloadTracker;
