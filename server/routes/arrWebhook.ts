import { isArrService, parseArrWebhook } from '@server/lib/arrWebhook';
import downloadTracker from '@server/lib/downloadtracker';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { timingSafeEqual } from 'crypto';
import { Router } from 'express';

/**
 * Receives Radarr/Sonarr/Lidarr webhooks. Each *arr gets a Webhook connection
 * (On Grab + On Import) pointing at
 * `/api/v1/arr-webhook/{radarr|sonarr|lidarr}/{Seerr server id}?apiKey=…`.
 * The *arrs can't send Seerr's X-Api-Key header, so the key rides in the URL.
 */
const arrWebhookRoutes = Router();

const sameKey = (given: unknown, expected: string): boolean => {
  if (typeof given !== 'string' || !expected) {
    return false;
  }

  const a = Buffer.from(given);
  const b = Buffer.from(expected);

  return a.length === b.length && timingSafeEqual(a, b);
};

arrWebhookRoutes.post('/:service/:serverId', async (req, res) => {
  const settings = getSettings();

  if (!sameKey(req.query.apiKey, settings.main.apiKey)) {
    return res.status(403).json({ status: 403, error: 'Invalid API key' });
  }

  const { service } = req.params;
  const serverId = Number(req.params.serverId);

  if (
    !isArrService(service) ||
    !settings[service].some((server) => server.id === serverId)
  ) {
    return res
      .status(404)
      .json({ status: 404, error: 'No such server configured in Seerr' });
  }

  const event = parseArrWebhook(service, req.body);

  switch (event.type) {
    case 'grab':
      logger.debug(`${service} grabbed a release`, {
        label: 'Arr Webhook',
        serverId,
        downloadId: event.downloadId,
      });
      await downloadTracker.addGrab({
        ...event,
        service,
        serverId,
        at: Date.now(),
      });
      break;
    case 'import':
      logger.debug(`${service} imported a download`, {
        label: 'Arr Webhook',
        serverId,
        downloadId: event.downloadId,
      });
      downloadTracker.markImported(service, serverId, event.downloadId);
      break;
    case 'test':
      logger.info(`Test webhook received from ${service} server ${serverId}`, {
        label: 'Arr Webhook',
      });
      break;
    default:
      break;
  }

  return res.status(200).json({ ok: true });
});

export default arrWebhookRoutes;
