import defineMessages from '@app/utils/defineMessages';
import type { IntlShape } from 'react-intl';

export const downloadEtaMessages = defineMessages('components.DownloadEta', {
  etaSoon: 'ETA <1 min',
  etaMinutes: 'ETA {minutes} min',
  etaHours: 'ETA {hours}h {minutes}m',
  importing: 'Importing',
  seasonsReady: '{seasons} ready',
  readyAndEta: '{ready} · {eta}',
});

/** "ETA 12 min" from milliseconds left, as qBittorrent reports it. */
export const formatDownloadEta = (
  intl: IntlShape,
  etaMs: number | undefined
): string | undefined => {
  if (etaMs === undefined) {
    return undefined;
  }

  if (etaMs < 60000) {
    return intl.formatMessage(downloadEtaMessages.etaSoon);
  }

  const minutes = Math.ceil(etaMs / 60000);

  return minutes < 60
    ? intl.formatMessage(downloadEtaMessages.etaMinutes, { minutes })
    : intl.formatMessage(downloadEtaMessages.etaHours, {
        hours: Math.floor(minutes / 60),
        minutes: minutes % 60,
      });
};
