import downloadTracker, {
  type LiveSnapshot,
} from '@server/lib/downloadtracker';
import { Router } from 'express';

const downloadRoutes = Router();

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
