import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import TmdbTitleCard from '@app/components/TitleCard/TmdbTitleCard';
import defineMessages from '@app/utils/defineMessages';
import { downloadEtaMessages } from '@app/utils/downloadEta';
import type { InProgressItem, InProgressPhase } from '@server/lib/inProgress';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

export const inProgressMessages = defineMessages('components.InProgress', {
  inProgress: 'In Progress',
  subtext:
    "Everything requested that isn't in the library yet, live from the download client.",
  downloading: 'Downloading',
  importing: 'Importing',
  searching: 'Searching',
  unreleased: 'Not Released Yet',
  notSent: 'Not Sent to Radarr/Sonarr',
  nothing: 'Nothing in progress right now.',
});

/** The list behind the page and the sidebar count. */
export const useInProgress = (refreshInterval: number) =>
  useSWR<{ results: InProgressItem[] }>('/api/v1/downloads/active', {
    refreshInterval,
  });

const PHASES: InProgressPhase[] = [
  'downloading',
  'importing',
  'searching',
  'unreleased',
  'notSent',
];

/** What a card in these groups says instead of "Searching…". */
const WAITING_LABELS: Partial<
  Record<InProgressPhase, keyof typeof downloadEtaMessages>
> = {
  unreleased: 'notReleased',
  notSent: 'notSent',
};

/**
 * Everything downloading, importing or still being searched for, as the
 * same title cards the rest of the app uses: each follows its own download
 * live, with the ring, season segments and ETA tag.
 */
const InProgress = () => {
  const intl = useIntl();
  // Phases change as downloads start and finish; the cards themselves
  // update live.
  const { data, error } = useInProgress(30 * 1000);
  const title = intl.formatMessage(inProgressMessages.inProgress);

  return (
    <>
      <PageTitle title={title} />
      <div className="mb-4">
        <Header subtext={intl.formatMessage(inProgressMessages.subtext)}>
          {title}
        </Header>
      </div>
      {!data && !error && <LoadingSpinner />}
      {data && data.results.length === 0 && (
        <div className="mt-32 w-full text-center text-2xl text-gray-400">
          {intl.formatMessage(inProgressMessages.nothing)}
        </div>
      )}
      {PHASES.map((phase) => {
        const items = (data?.results ?? []).filter(
          (item) => item.phase === phase
        );

        if (items.length === 0) {
          return null;
        }

        const labelKey = WAITING_LABELS[phase];
        const waitingLabel = labelKey
          ? intl.formatMessage(downloadEtaMessages[labelKey])
          : undefined;

        return (
          <section key={phase} className="mb-8">
            <h3 className="mb-3 text-xl font-bold text-gray-200">
              {intl.formatMessage(inProgressMessages[phase])}
              <span className="ml-2 text-base font-medium text-gray-400">
                {items.length}
              </span>
            </h3>
            <ul className="cards-vertical">
              {items.map((item) => (
                <li key={`${item.mediaType}-${item.tmdbId}`}>
                  <TmdbTitleCard
                    id={item.id}
                    tmdbId={item.tmdbId}
                    type={item.mediaType}
                    canExpand
                    waitingLabel={waitingLabel}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
};

export default InProgress;
