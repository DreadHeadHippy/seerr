import { MediaStatus } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import downloadTracker, {
  type LiveSnapshot,
} from '@server/lib/downloadtracker';
import logger from '@server/logger';
import { Router } from 'express';

const downloadRoutes = Router();

export interface ActiveDownload {
  id: number;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  phase: 'downloading' | 'importing' | 'searching';
}

const PHASE_ORDER: ActiveDownload['phase'][] = [
  'downloading',
  'importing',
  'searching',
];

/**
 * Everything on its way to the library: movies and series processing (or
 * with a season processing), downloading first, then importing, then still
 * being searched for; most recently changed first within each.
 */
downloadRoutes.get('/active', async (_req, res, next) => {
  try {
    const media = await getRepository(Media)
      .createQueryBuilder('media')
      .leftJoin('media.seasons', 'season')
      .where('media.status = :processing', {
        processing: MediaStatus.PROCESSING,
      })
      .orWhere('season.status = :processing', {
        processing: MediaStatus.PROCESSING,
      })
      .orderBy('media.updatedAt', 'DESC')
      .getMany();

    const results: ActiveDownload[] = media
      .filter((m) => m.mediaType === 'movie' || m.mediaType === 'tv')
      .map((m) => ({
        id: m.id,
        tmdbId: m.tmdbId,
        mediaType: m.mediaType as ActiveDownload['mediaType'],
        phase:
          (m.downloadStatus ?? []).length > 0
            ? 'downloading'
            : m.downloadImporting
              ? 'importing'
              : 'searching',
      }));

    // Stable, so updatedAt order holds within each phase.
    results.sort(
      (a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase)
    );

    return res.status(200).json({ results });
  } catch (e) {
    logger.error('Unable to list media in progress', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({ status: 500, message: 'Unable to list media in progress.' });
  }
});

/** Comment lines keep proxies (Cloudflare drops idle ones at 100s) open. */
const HEARTBEAT_MS = 20 * 1000;

/**
 * Live download progress straight from qBittorrent, as server-sent events:
 * one `data:` message per change, by lowercase torrent hash. Title cards
 * match it to their downloads' downloadId.
 */
downloadRoutes.get('/live', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    // no-transform: keeps Cloudflare from buffering or compressing it.
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let last = '';
  const send = (snapshot: LiveSnapshot) => {
    const data = JSON.stringify(snapshot);

    if (data !== last) {
      last = data;
      res.write(`data: ${data}\n\n`);
    }
  };

  // Tell EventSource to come back quickly if the connection drops.
  res.write('retry: 3000\n\n');
  send(downloadTracker.getLiveSnapshot());

  const unsubscribe = downloadTracker.subscribeLive(send);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

export default downloadRoutes;
