import defineMessages from '@app/utils/defineMessages';
import type { IntlShape } from 'react-intl';

export const downloadEtaMessages = defineMessages('components.DownloadEta', {
  etaSoon: 'ETA <1 min',
  etaMinutes: 'ETA {minutes} min',
  etaHours: 'ETA {hours}h {minutes}m',
  importing: 'Importing',
  seasonsReady: '{seasons} ready',
  searching: 'Searching…',
  stalled: 'Stalled',
  queued: 'Queued',
  paused: 'Paused',
  etaShortSoon: 'ETA <1m',
  etaShortMinutes: 'ETA {minutes}m',
  etaShortHours: 'ETA {hours}h {minutes}m',
  etaShortLongHours: 'ETA {hours}h',
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

/** "ETA 12m": short enough for the tag on a 144px poster card. */
export const formatDownloadEtaShort = (
  intl: IntlShape,
  etaMs: number | undefined
): string | undefined => {
  if (etaMs === undefined) {
    return undefined;
  }

  if (etaMs < 60000) {
    return intl.formatMessage(downloadEtaMessages.etaShortSoon);
  }

  const minutes = Math.ceil(etaMs / 60000);
  const hours = Math.floor(minutes / 60);

  if (minutes < 60) {
    return intl.formatMessage(downloadEtaMessages.etaShortMinutes, {
      minutes,
    });
  }

  // Minutes stop mattering, and stop fitting, past ten hours.
  return hours >= 10
    ? intl.formatMessage(downloadEtaMessages.etaShortLongHours, { hours })
    : intl.formatMessage(downloadEtaMessages.etaShortHours, {
        hours,
        minutes: minutes % 60,
      });
};
