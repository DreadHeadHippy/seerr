import RadarrAPI, { type RadarrMovie } from '@server/api/servarr/radarr';
import SonarrAPI, { type SonarrSeries } from '@server/api/servarr/sonarr';
import type { ArrService } from '@server/lib/arrWebhook';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

/**
 * Brings Seerr's status for one movie or series in line with Radarr/Sonarr
 * right away, using the same logic as the scheduled Radarr/Sonarr scans
 * (so only for servers with Enable Scan on). With a file in the *arr, it
 * turns available, and requesters are notified, without waiting hours for
 * the next scan.
 */
export const syncMovie = async (
  serverId: number,
  movie: RadarrMovie
): Promise<void> => {
  const server = getSettings().radarr.find((s) => s.id === serverId);

  if (!server) {
    return;
  }

  // Imported here: the scanners import Media, which imports the download
  // tracker, which the webhook route also imports.
  const { radarrScanner } = await import('@server/lib/scanners/radarr');
  await radarrScanner.syncOne(server, movie);
};

export const syncSeries = async (
  serverId: number,
  series: SonarrSeries
): Promise<void> => {
  const server = getSettings().sonarr.find((s) => s.id === serverId);

  if (!server) {
    return;
  }

  const { sonarrScanner } = await import('@server/lib/scanners/sonarr');
  await sonarrScanner.syncOne(server, series);
};

/**
 * Looks the movie or series up in its *arr and syncs it. Never throws:
 * the scheduled scans remain the fallback.
 */
export const syncFromArr = async (
  service: ArrService,
  serverId: number,
  externalId: number
): Promise<void> => {
  try {
    if (service === 'radarr') {
      const server = getSettings().radarr.find((s) => s.id === serverId);

      if (server) {
        const movie = await new RadarrAPI({
          apiKey: server.apiKey,
          url: RadarrAPI.buildUrl(server, '/api/v3'),
        }).getMovie({ id: externalId });
        await syncMovie(serverId, movie);
      }
    } else if (service === 'sonarr') {
      const server = getSettings().sonarr.find((s) => s.id === serverId);

      if (server) {
        const series = await new SonarrAPI({
          apiKey: server.apiKey,
          url: SonarrAPI.buildUrl(server, '/api/v3'),
        }).getSeriesById(externalId);
        await syncSeries(serverId, series);
      }
    }
  } catch (e) {
    logger.warn(`Unable to sync an imported item from ${service}`, {
      label: 'Arr Sync',
      serverId,
      externalId,
      errorMessage: e.message,
    });
  }
};

/** Sonarr sends one import per episode; a season pack syncs once. */
const SOON_MS = 5 * 1000;
const pending = new Map<string, ReturnType<typeof setTimeout>>();

/** syncFromArr a few seconds after the last call for the same item. */
export const syncFromArrSoon = (
  service: ArrService,
  serverId: number,
  externalId: number
): void => {
  const key = `${service}:${serverId}:${externalId}`;
  clearTimeout(pending.get(key));
  pending.set(
    key,
    setTimeout(() => {
      pending.delete(key);
      syncFromArr(service, serverId, externalId);
    }, SOON_MS)
  );
};
