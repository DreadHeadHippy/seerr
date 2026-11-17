import defineMessages from '@app/utils/defineMessages';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('hooks.useReadyEta', {
  readySoon: 'Ready in a few minutes',
  readyMinutes:
    'Ready in about {minutes, plural, one {# minute} other {# minutes}}',
  readyHours: 'Ready in about {hours, plural, one {# hour} other {# hours}}',
  readyDays: 'Ready in about {days, plural, one {# day} other {# days}}',
  downloading: 'Downloading',
  shortSoon: 'Soon',
  shortMinutes: '~{minutes} min',
  shortHours: '~{hours} hr',
  shortDays: '~{days} d',
});

const MINUTE = 60 * 1000;

/**
 * Time from a finished download to watchable: the *arr importing the files
 * and the media server picking them up. Rough, like the estimate itself.
 */
export const IMPORT_BUFFER_MS = 5 * MINUTE;

/**
 * When the slowest of these downloads should be watchable, or undefined when
 * any of them has no estimate (queued, paused, stalled).
 */
export const readyAtFromDownloads = (
  downloads: {
    status?: string;
    estimatedCompletionTime?: string | Date | null;
  }[]
): string | undefined => {
  const now = Date.now();
  let latest = 0;

  for (const download of downloads) {
    // Downloaded and waiting for import.
    if (download.status === 'completed') {
      latest = Math.max(latest, now + IMPORT_BUFFER_MS);
      continue;
    }

    const eta = download.estimatedCompletionTime
      ? new Date(download.estimatedCompletionTime).getTime()
      : NaN;

    if (!Number.isFinite(eta)) {
      return undefined;
    }

    latest = Math.max(latest, Math.max(eta, now) + IMPORT_BUFFER_MS);
  }

  return latest ? new Date(latest).toISOString() : undefined;
};

/** Rounded so the estimate never looks more precise than it is. */
const roundedEta = (readyAt: string, now: number) => {
  const minutes = Math.max(0, (Date.parse(readyAt) - now) / MINUTE);

  if (minutes < 5) {
    return { unit: 'soon' as const, value: 0 };
  }

  if (minutes < 60) {
    return { unit: 'minutes' as const, value: Math.ceil(minutes / 5) * 5 };
  }

  if (minutes < 48 * 60) {
    return { unit: 'hours' as const, value: Math.round(minutes / 60) };
  }

  return { unit: 'days' as const, value: Math.round(minutes / (24 * 60)) };
};

/** Re-renders every half minute so the estimate counts down. */
const useNow = (active: boolean) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) {
      return;
    }

    const timer = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => clearInterval(timer);
  }, [active]);

  return now;
};

/**
 * Roughly how long until something downloading is watchable, without saying
 * where the estimate comes from. `short` suits cards ("~25 min"), `full`
 * reads "Ready in about 25 minutes". Without an estimate it says
 * Downloading. Undefined when nothing is downloading.
 */
const useReadyEta = (
  isDownloading: boolean,
  readyAt?: string
): { short: string; full: string } | undefined => {
  const intl = useIntl();
  const now = useNow(isDownloading);

  if (!isDownloading) {
    return undefined;
  }

  if (!readyAt) {
    const text = intl.formatMessage(messages.downloading);
    return { short: text, full: text };
  }

  const { unit, value } = roundedEta(readyAt, now);

  switch (unit) {
    case 'soon':
      return {
        short: intl.formatMessage(messages.shortSoon),
        full: intl.formatMessage(messages.readySoon),
      };
    case 'minutes':
      return {
        short: intl.formatMessage(messages.shortMinutes, { minutes: value }),
        full: intl.formatMessage(messages.readyMinutes, { minutes: value }),
      };
    case 'hours':
      return {
        short: intl.formatMessage(messages.shortHours, { hours: value }),
        full: intl.formatMessage(messages.readyHours, { hours: value }),
      };
    default:
      return {
        short: intl.formatMessage(messages.shortDays, { days: value }),
        full: intl.formatMessage(messages.readyDays, { days: value }),
      };
  }
};

export default useReadyEta;
