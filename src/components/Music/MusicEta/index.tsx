import defineMessages from '@app/utils/defineMessages';
import type { MusicDownload } from '@server/interfaces/api/musicInterfaces';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Music.MusicEta', {
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

/** Rounded so the estimate never looks more precise than it is. */
const roundedEta = (readyAt: string, now: number) => {
  const minutes = Math.max(0, (Date.parse(readyAt) - now) / MINUTE);

  if (minutes < 5) {
    return { unit: 'soon' as const };
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
const useNow = () => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => clearInterval(timer);
  }, []);

  return now;
};

/**
 * Roughly how long until a downloading artist or album is playable in Plex.
 * `short` is for cards ("~25 min"); the full form reads "Ready in about 25
 * minutes". Without an estimate (queued, stalled) it just says Downloading.
 */
export const useMusicEta = (download?: MusicDownload) => {
  const intl = useIntl();
  const now = useNow();

  if (!download) {
    return undefined;
  }

  if (!download.readyAt) {
    const text = intl.formatMessage(messages.downloading);
    return { short: text, full: text };
  }

  const eta = roundedEta(download.readyAt, now);

  switch (eta.unit) {
    case 'soon':
      return {
        short: intl.formatMessage(messages.shortSoon),
        full: intl.formatMessage(messages.readySoon),
      };
    case 'minutes':
      return {
        short: intl.formatMessage(messages.shortMinutes, {
          minutes: eta.value,
        }),
        full: intl.formatMessage(messages.readyMinutes, {
          minutes: eta.value,
        }),
      };
    case 'hours':
      return {
        short: intl.formatMessage(messages.shortHours, { hours: eta.value }),
        full: intl.formatMessage(messages.readyHours, { hours: eta.value }),
      };
    default:
      return {
        short: intl.formatMessage(messages.shortDays, { days: eta.value }),
        full: intl.formatMessage(messages.readyDays, { days: eta.value }),
      };
  }
};

/** A small always-visible pill for artist and album cards. */
export const MusicEtaPill = ({ download }: { download?: MusicDownload }) => {
  const eta = useMusicEta(download);

  if (!eta) {
    return null;
  }

  return (
    <div
      className="pointer-events-none z-40 whitespace-nowrap rounded-full border border-indigo-400 bg-indigo-500/80 px-2 text-xs font-medium leading-5 text-indigo-100 shadow-md"
      title={eta.full}
    >
      {eta.short}
    </div>
  );
};
