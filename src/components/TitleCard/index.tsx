import Spinner from '@app/assets/spinner.svg';
import BlocklistModal from '@app/components/BlocklistModal';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import DownloadRing from '@app/components/Common/DownloadRing';
import StatusBadgeMini from '@app/components/Common/StatusBadgeMini';
import Tooltip from '@app/components/Common/Tooltip';
import RequestModal from '@app/components/RequestModal';
import ErrorCard from '@app/components/TitleCard/ErrorCard';
import Placeholder from '@app/components/TitleCard/Placeholder';
import { useIsTouch } from '@app/hooks/useIsTouch';
import { useLiveTorrents } from '@app/hooks/useLiveTorrents';
import useToasts from '@app/hooks/useToasts';
import { Permission, UserType, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import {
  downloadEtaMessages,
  formatDownloadEtaShort,
} from '@app/utils/downloadEta';
import { cardRefreshInterval } from '@app/utils/refreshIntervalHelper';
import { movieReleaseStage } from '@app/utils/releaseStage';
import {
  followedSeasons,
  formatSeasonRanges,
  seasonProgress,
  seriesProgress,
  stallReason,
  torrentProgress,
  withLiveTorrents,
} from '@app/utils/seasonProgress';
import { withProperties } from '@app/utils/typeHelpers';
import { Transition } from '@headlessui/react';
import {
  ArrowDownTrayIcon,
  CheckIcon,
  EyeIcon,
  EyeSlashIcon,
  MinusCircleIcon,
  StarIcon,
} from '@heroicons/react/24/outline';
import { MediaStatus } from '@server/constants/media';
import type { Watchlist } from '@server/entity/Watchlist';
import type { DownloadingItem } from '@server/lib/downloadtracker';
import type { MovieDetails } from '@server/models/Movie';
import type { MediaType } from '@server/models/Search';
import type { TvDetails } from '@server/models/Tv';
import axios from 'axios';
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

interface TitleCardProps {
  id: number;
  image?: string;
  summary?: string;
  year?: string;
  title: string;
  userScore?: number;
  mediaType: MediaType;
  status?: MediaStatus;
  canExpand?: boolean;
  inProgress?: boolean;
  /** Said instead of "Searching…" (e.g. "Not released"). */
  waitingLabel?: string;
  /** The media's download progress, for the ring on the status badge. */
  downloads?: DownloadingItem[];
  isAddedToWatchlist?: number | boolean;
  mutateParent?: () => void;
}

/** ETA tag colours: counting down, waiting on the *arr, or stuck. */
type EtaTone = 'eta' | 'muted' | 'warn';
const ETA_TONES: Record<EtaTone, string> = {
  eta: 'border-indigo-500 bg-indigo-600/80',
  muted: 'border-gray-500 bg-gray-600/80',
  warn: 'border-amber-500 bg-amber-600/80',
};

const messages = defineMessages('components.TitleCard', {
  addToWatchList: 'Add to watchlist',
  watchlistSuccess:
    '<strong>{title}</strong> added to watchlist  successfully!',
  watchlistDeleted:
    '<strong>{title}</strong> Removed from watchlist  successfully!',
  watchlistCancel: 'watchlist for <strong>{title}</strong> canceled.',
  watchlistError: 'Something went wrong. Please try again.',
});

const TitleCard = ({
  id,
  image,
  summary,
  year,
  title,
  status,
  mediaType,
  isAddedToWatchlist = false,
  inProgress = false,
  waitingLabel,
  downloads,
  canExpand = false,
  mutateParent,
}: TitleCardProps) => {
  const isTouch = useIsTouch();
  const intl = useIntl();
  const { user, hasPermission } = useUser();
  const [isUpdating, setIsUpdating] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(status);
  const [showDetail, setShowDetail] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const { addToast } = useToasts();
  const [toggleWatchlist, setToggleWatchlist] =
    useState<boolean>(!isAddedToWatchlist);
  const [showBlocklistModal, setShowBlocklistModal] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const { ref: inViewRef, inView } = useInView();
  const setCardRef = useCallback(
    (node: HTMLDivElement | null) => {
      cardRef.current = node;
      inViewRef(node);
    },
    [inViewRef]
  );
  /** Requested from this card, so it follows the request to available. */
  const [requestedHere, setRequestedHere] = useState(false);
  /** The status changed while on screen: animate the new badge in. */
  const [badgeChanged, setBadgeChanged] = useState(false);
  /** A download was seen, so an empty queue now means it's importing. */
  const [sawDownload, setSawDownload] = useState(false);
  /** Seasons a download was seen for, for the same reason. */
  const [seenSeasons, setSeenSeasons] = useState<Set<number>>(() => new Set());

  // While something is on its way, keep this card's progress current.
  const following =
    mediaType !== 'collection' &&
    (requestedHere ||
      sawDownload ||
      currentStatus === MediaStatus.PROCESSING ||
      (downloads ?? []).length > 0);
  const { data: latest } = useSWR<MovieDetails | TvDetails>(
    inView && following
      ? `/api/v1/${mediaType === 'movie' ? 'movie' : 'tv'}/${id}`
      : null,
    {
      refreshInterval: (data) =>
        cardRefreshInterval(
          data?.mediaInfo ?? {
            status: currentStatus,
            downloadStatus: downloads,
          },
          // Importing: Plex usually has it within a minute.
          requestedHere || sawDownload
        ),
      revalidateOnFocus: false,
      // Scrolling away nulls the key; keep showing what we had meanwhile.
      keepPreviousData: true,
    }
  );
  const latestStatus = latest?.mediaInfo?.status;
  // Only the card's own fetch counts. The list's `downloads` can be a cached
  // page from long ago (0%, an ETA of hours) and only says to start following.
  const activeDownloads = latest?.mediaInfo?.downloadStatus ?? [];
  // The server knows when the *arr imported it, even if this card never saw
  // the download (opened afterwards).
  const serverImporting = !!latest?.mediaInfo?.downloadImporting;
  const importing =
    (sawDownload || serverImporting) &&
    activeDownloads.length === 0 &&
    currentStatus === MediaStatus.PROCESSING;

  const downloadingSeasons = [
    ...new Set(
      activeDownloads.flatMap((d) =>
        d.episode ? [d.episode.seasonNumber] : []
      )
    ),
  ]
    .sort((a, b) => a - b)
    .join(',');

  useEffect(() => {
    if (activeDownloads.length > 0) {
      setSawDownload(true);
    }
  }, [activeDownloads.length]);

  useEffect(() => {
    if (downloadingSeasons) {
      setSeenSeasons((seen) => {
        const next = new Set(seen);
        downloadingSeasons.split(',').forEach((n) => next.add(Number(n)));
        return next.size === seen.size ? seen : next;
      });
    }
  }, [downloadingSeasons]);

  // qBittorrent's live numbers in place of the queue's.
  const liveTorrents = useLiveTorrents(activeDownloads.length > 0);
  const liveDownloads = withLiveTorrents(activeDownloads, liveTorrents);
  const now = Date.now();
  const live = torrentProgress(liveDownloads, now);

  // A series follows each requested season separately: packs per season,
  // or one complete-series pack.
  const tvInfo = mediaType === 'tv' ? latest?.mediaInfo : undefined;
  const seasons = tvInfo
    ? seasonProgress(
        followedSeasons(tvInfo.requests ?? [], liveDownloads),
        tvInfo.seasons ?? [],
        liveDownloads,
        new Set([...seenSeasons, ...(tvInfo.importingSeasons ?? [])]),
        now
      )
    : [];
  const series = seasons.length > 1 ? seriesProgress(seasons) : undefined;

  const showRing =
    currentStatus !== MediaStatus.AVAILABLE &&
    (activeDownloads.length > 0 ||
      importing ||
      // Some seasons in, others still to come.
      (!!series &&
        (sawDownload || serverImporting) &&
        seasons.some((season) => season.phase !== 'available')));
  const ringImporting = series ? series.importing : importing || live.done;

  // A requested season Sonarr hasn't grabbed anything for yet.
  const searchingSeason = seasons.some(
    (season) =>
      season.phase === 'waiting' &&
      (tvInfo?.seasons ?? []).some(
        (s) =>
          s.seasonNumber === season.seasonNumber &&
          s.status === MediaStatus.PROCESSING
      )
  );
  const etaTag = ((): { text: string; tone: EtaTone } | undefined => {
    const searching = {
      text: waitingLabel ?? intl.formatMessage(downloadEtaMessages.searching),
      tone: 'muted' as const,
    };

    if (!showRing) {
      // Only from the card's own fetch: the list's copy may be old.
      if (
        !latest ||
        (currentStatus !== MediaStatus.PROCESSING && !searchingSeason)
      ) {
        return undefined;
      }

      // Nothing to grab yet for a film that isn't out to stream or buy.
      const stage =
        mediaType === 'movie' && !waitingLabel
          ? movieReleaseStage(latest as MovieDetails, now)
          : 'released';

      return stage === 'released'
        ? searching
        : {
            text: intl.formatMessage(
              stage === 'inTheaters'
                ? downloadEtaMessages.inTheaters
                : downloadEtaMessages.notReleased
            ),
            tone: 'muted',
          };
    }

    if (ringImporting) {
      return {
        text: intl.formatMessage(downloadEtaMessages.importing),
        tone: 'eta',
      };
    }

    // Short, to fit beside the type tag on a narrow card.
    const eta = formatDownloadEtaShort(
      intl,
      series ? series.etaMs : live.etaMs
    );

    if (eta) {
      return { text: eta, tone: 'eta' };
    }

    const stalled = series
      ? seasons.find((season) => season.stalled)?.stalled
      : stallReason(liveDownloads);

    if (stalled) {
      return {
        text: intl.formatMessage(downloadEtaMessages[stalled]),
        tone: 'warn',
      };
    }

    // Which seasons are in shows on the ring; say so here only when
    // there's nothing else to say.
    if (series && series.ready.length > 0) {
      return {
        text: intl.formatMessage(downloadEtaMessages.seasonsReady, {
          seasons: formatSeasonRanges(series.ready),
        }),
        tone: 'eta',
      };
    }

    return searchingSeason ? searching : undefined;
  })();
  const etaLabel = etaTag?.text;
  /** Just became available while on screen: a big check, briefly. */
  const [justAvailable, setJustAvailable] = useState(false);

  useEffect(() => {
    if (latestStatus !== undefined && latestStatus !== currentStatus) {
      setBadgeChanged(true);
      setCurrentStatus(latestStatus);

      if (latestStatus === MediaStatus.AVAILABLE) {
        setJustAvailable(true);
      }
    }
    // Only when the server's status changes, not when it's set locally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestStatus]);

  useEffect(() => {
    if (!justAvailable) {
      return;
    }

    const timer = setTimeout(() => setJustAvailable(false), 5000);
    return () => clearTimeout(timer);
  }, [justAvailable]);

  // Just to get the year from the date
  if (year) {
    year = year.slice(0, 4);
  }

  useEffect(() => {
    setCurrentStatus(status);
  }, [status]);

  const requestComplete = useCallback((newStatus: MediaStatus) => {
    setCurrentStatus(newStatus);
    setRequestedHere(true);
    setShowRequestModal(false);
  }, []);

  const requestUpdating = useCallback(
    (status: boolean) => setIsUpdating(status),
    []
  );

  const closeBlocklistModal = useCallback(
    () => setShowBlocklistModal(false),
    []
  );

  const onClickWatchlistBtn = async (): Promise<void> => {
    setIsUpdating(true);
    try {
      const response = await axios.post<Watchlist>('/api/v1/watchlist', {
        tmdbId: id,
        mediaType,
        title,
      });
      mutate('/api/v1/discover/watchlist');
      if (response.data) {
        addToast(
          <span>
            {intl.formatMessage(messages.watchlistSuccess, {
              title,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            })}
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
      }
    } catch {
      addToast(intl.formatMessage(messages.watchlistError), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdating(false);
      setToggleWatchlist((prevState) => !prevState);
    }
  };

  const onClickDeleteWatchlistBtn = async (): Promise<void> => {
    setIsUpdating(true);
    try {
      const response = await axios.delete<Watchlist>(
        `/api/v1/watchlist/${id}?mediaType=${mediaType}`
      );

      if (response.status === 204) {
        addToast(
          <span>
            {intl.formatMessage(messages.watchlistDeleted, {
              title,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            })}
          </span>,
          { appearance: 'info', autoDismiss: true }
        );
      }
    } catch {
      addToast(intl.formatMessage(messages.watchlistError), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdating(false);
      mutate('/api/v1/discover/watchlist');
      if (mutateParent) {
        mutateParent();
      }
      setToggleWatchlist((prevState) => !prevState);
    }
  };

  const onClickHideItemBtn = async (): Promise<void> => {
    setIsUpdating(true);
    const topNode = cardRef.current;

    if (topNode) {
      try {
        if (mediaType === 'collection') {
          await axios.post(`/api/v1/blocklist/collection/${id}`);
        } else {
          await axios.post('/api/v1/blocklist', {
            tmdbId: id,
            mediaType,
            title,
            user: user?.id,
          });
        }
        addToast(
          <span>
            {intl.formatMessage(globalMessages.blocklistSuccess, {
              title,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            })}
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
        setCurrentStatus(MediaStatus.BLOCKLISTED);
        if (mutateParent) {
          mutateParent();
        }
      } catch (e) {
        if (e?.response?.status === 412) {
          addToast(
            <span>
              {intl.formatMessage(globalMessages.blocklistDuplicateError, {
                title,
                strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
              })}
            </span>,
            { appearance: 'info', autoDismiss: true }
          );
        } else {
          addToast(intl.formatMessage(globalMessages.blocklistError), {
            appearance: 'error',
            autoDismiss: true,
          });
        }
      }

      setIsUpdating(false);
      closeBlocklistModal();
    } else {
      addToast(intl.formatMessage(globalMessages.blocklistError), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  const onClickShowBlocklistBtn = async (): Promise<void> => {
    setIsUpdating(true);
    const topNode = cardRef.current;

    if (topNode) {
      try {
        if (mediaType === 'collection') {
          const res = await axios.delete(`/api/v1/blocklist/collection/${id}`);

          if (res.status === 204) {
            addToast(
              <span>
                {intl.formatMessage(globalMessages.removeFromBlocklistSuccess, {
                  title,
                  strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
                })}
              </span>,
              { appearance: 'success', autoDismiss: true }
            );
            setCurrentStatus(MediaStatus.UNKNOWN);
            if (mutateParent) {
              mutateParent();
            }
          } else {
            addToast(intl.formatMessage(globalMessages.blocklistError), {
              appearance: 'error',
              autoDismiss: true,
            });
          }
        } else {
          const res = await axios.delete(
            `/api/v1/blocklist/${id}?mediaType=${mediaType}`
          );

          if (res.status === 204) {
            addToast(
              <span>
                {intl.formatMessage(globalMessages.removeFromBlocklistSuccess, {
                  title,
                  strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
                })}
              </span>,
              { appearance: 'success', autoDismiss: true }
            );
            setCurrentStatus(MediaStatus.UNKNOWN);
            if (mutateParent) {
              mutateParent();
            }
          } else {
            addToast(intl.formatMessage(globalMessages.blocklistError), {
              appearance: 'error',
              autoDismiss: true,
            });
          }
        }
      } catch {
        addToast(intl.formatMessage(globalMessages.blocklistError), {
          appearance: 'error',
          autoDismiss: true,
        });
      }
    } else {
      addToast(intl.formatMessage(globalMessages.blocklistError), {
        appearance: 'error',
        autoDismiss: true,
      });
    }

    setIsUpdating(false);
  };

  const closeModal = useCallback(() => setShowRequestModal(false), []);

  const showRequestButton = hasPermission(
    [
      Permission.REQUEST,
      mediaType === 'movie' || mediaType === 'collection'
        ? Permission.REQUEST_MOVIE
        : Permission.REQUEST_TV,
    ],
    { type: 'or' }
  );

  const showHideButton = hasPermission([Permission.MANAGE_BLOCKLIST], {
    type: 'or',
  });

  return (
    <div
      className={canExpand ? 'w-full' : 'w-36 sm:w-36 md:w-44'}
      data-testid="title-card"
      ref={setCardRef}
    >
      <RequestModal
        tmdbId={id}
        show={showRequestModal}
        type={
          mediaType === 'movie'
            ? 'movie'
            : mediaType === 'collection'
              ? 'collection'
              : 'tv'
        }
        onComplete={requestComplete}
        onUpdating={requestUpdating}
        onCancel={closeModal}
      />
      <BlocklistModal
        tmdbId={id}
        type={
          mediaType === 'movie'
            ? 'movie'
            : mediaType === 'collection'
              ? 'collection'
              : 'tv'
        }
        show={showBlocklistModal}
        onCancel={closeBlocklistModal}
        onComplete={onClickHideItemBtn}
        isUpdating={isUpdating}
      />
      <div
        className={`relative transform-gpu cursor-default overflow-hidden rounded-xl bg-gray-800 bg-cover outline-none ring-1 transition duration-300 ${
          showDetail
            ? 'scale-105 shadow-lg ring-gray-500'
            : 'scale-100 shadow ring-gray-700'
        }`}
        style={{
          paddingBottom: '150%',
        }}
        onMouseEnter={() => {
          if (!isTouch) {
            setShowDetail(true);
          }
        }}
        onMouseLeave={() => setShowDetail(false)}
        onClick={() => setShowDetail(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setShowDetail(true);
          }
        }}
        role="link"
        tabIndex={0}
      >
        <div className="absolute inset-0 h-full w-full overflow-hidden">
          <CachedImage
            type="tmdb"
            className="absolute inset-0 h-full w-full"
            alt=""
            src={
              image
                ? `https://image.tmdb.org/t/p/w300_and_h450_face${image}`
                : `/images/seerr_poster_not_found_logo_top.png`
            }
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            fill
          />
          <div
            className={`absolute left-0 right-0 flex items-center justify-between p-2 ${
              currentStatus && currentStatus !== MediaStatus.UNKNOWN
                ? 'pr-6 sm:pr-7'
                : ''
            }`}
          >
            <div className="pointer-events-none z-40 flex min-w-0 flex-nowrap items-center gap-1 self-start">
              <div
                className={`shrink-0 rounded-full border shadow-md ${
                  mediaType === 'movie' || mediaType === 'collection'
                    ? 'border-blue-500 bg-blue-600/80'
                    : 'border-purple-600 bg-purple-600/80'
                }`}
              >
                <div
                  className={`flex h-4 items-center py-2 text-center font-medium uppercase text-white sm:h-5 ${
                    // Smaller beside an ETA, so both fit on a 144px card.
                    etaLabel
                      ? 'px-1.5 text-[10px] tracking-wide'
                      : 'px-2 text-xs tracking-wider'
                  }`}
                >
                  {mediaType === 'movie'
                    ? intl.formatMessage(globalMessages.movie)
                    : mediaType === 'collection'
                      ? intl.formatMessage(globalMessages.collection)
                      : intl.formatMessage(globalMessages.tvshow)}
                </div>
              </div>
              {etaTag && (
                <div
                  className={`min-w-0 rounded-full border shadow-md ${ETA_TONES[etaTag.tone]}`}
                >
                  <div className="flex h-4 items-center px-1.5 py-2 text-[10px] font-medium text-white sm:h-5">
                    <span className="truncate">{etaTag.text}</span>
                  </div>
                </div>
              )}
            </div>
            {showDetail && currentStatus !== MediaStatus.BLOCKLISTED && (
              <div className="flex flex-col gap-1">
                {user?.userType !== UserType.PLEX &&
                  (toggleWatchlist ? (
                    <Button
                      buttonType={'ghost'}
                      className="z-40"
                      buttonSize={'sm'}
                      onClick={onClickWatchlistBtn}
                    >
                      <StarIcon className={'h-3 text-amber-300'} />
                    </Button>
                  ) : (
                    <Button
                      className="z-40"
                      buttonSize={'sm'}
                      onClick={onClickDeleteWatchlistBtn}
                    >
                      <MinusCircleIcon className={'h-3'} />
                    </Button>
                  ))}
                {showHideButton &&
                  currentStatus !== MediaStatus.PROCESSING &&
                  currentStatus !== MediaStatus.AVAILABLE &&
                  currentStatus !== MediaStatus.PARTIALLY_AVAILABLE &&
                  currentStatus !== MediaStatus.PENDING && (
                    <Button
                      buttonType={'ghost'}
                      className="z-40"
                      buttonSize={'sm'}
                      onClick={() => setShowBlocklistModal(true)}
                    >
                      <EyeSlashIcon className={'h-3'} />
                    </Button>
                  )}
              </div>
            )}
            {showDetail &&
              showHideButton &&
              currentStatus == MediaStatus.BLOCKLISTED && (
                <Tooltip
                  content={intl.formatMessage(
                    globalMessages.removefromBlocklist
                  )}
                >
                  <Button
                    buttonType={'ghost'}
                    className="z-40"
                    buttonSize={'sm'}
                    onClick={() => onClickShowBlocklistBtn()}
                  >
                    <EyeIcon className={'h-3'} />
                  </Button>
                </Tooltip>
              )}
          </div>
          {/* Tucked into the corner, clear of the tags. */}
          {currentStatus && currentStatus !== MediaStatus.UNKNOWN && (
            <div className="pointer-events-none absolute right-1 top-1 z-40 flex">
              <Transition
                key={currentStatus}
                appear={badgeChanged}
                show
                enter="transition duration-500 ease-out"
                enterFrom="scale-0 opacity-0"
                enterTo="scale-100 opacity-100"
              >
                <div className="flex">
                  <StatusBadgeMini
                    status={currentStatus}
                    inProgress={inProgress && !latest}
                    shrink
                  />
                </div>
              </Transition>
            </div>
          )}
          {/* Download progress, then a check once it's in the library. Hidden
              while hovering so it doesn't cover the details. */}
          {!showDetail && (
            <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
              {showRing ? (
                <DownloadRing
                  progress={series ? series.progress : live.progress}
                  importing={ringImporting}
                  segments={series ? seasons : undefined}
                />
              ) : (
                <Transition
                  appear
                  show={justAvailable}
                  enter="transition duration-500 ease-out"
                  enterFrom="scale-0 opacity-0"
                  enterTo="scale-100 opacity-100"
                  leave="transition-opacity duration-700"
                  leaveFrom="opacity-100"
                  leaveTo="opacity-0"
                >
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/90 text-white shadow-lg ring-4 ring-green-300/50 sm:h-20 sm:w-20">
                    <CheckIcon className="h-10 w-10 sm:h-12 sm:w-12" />
                  </div>
                </Transition>
              )}
            </div>
          )}
          <Transition
            as={Fragment}
            show={isUpdating}
            enter="transition-opacity ease-in-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity ease-in-out duration-300"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="absolute inset-0 z-40 flex items-center justify-center rounded-xl bg-gray-800/75 text-white">
              <Spinner className="h-10 w-10" />
            </div>
          </Transition>

          <Transition
            as={Fragment}
            show={!image || showDetail || showRequestModal}
            enter="transition-opacity"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="absolute inset-0 overflow-hidden rounded-xl">
              <Link
                href={
                  mediaType === 'movie'
                    ? `/movie/${id}`
                    : mediaType === 'collection'
                      ? `/collection/${id}`
                      : `/tv/${id}`
                }
                className="absolute inset-0 h-full w-full cursor-pointer overflow-hidden text-left"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(45, 55, 72, 0.4) 0%, rgba(45, 55, 72, 0.9) 100%)',
                }}
              >
                <div className="flex h-full w-full items-end">
                  <div
                    className={`px-2 text-white ${
                      !showRequestButton ||
                      (currentStatus &&
                        currentStatus !== MediaStatus.UNKNOWN &&
                        currentStatus !== MediaStatus.DELETED)
                        ? 'pb-2'
                        : 'pb-11'
                    }`}
                  >
                    {year && <div className="text-sm font-medium">{year}</div>}

                    <h1
                      className="whitespace-normal text-xl font-bold leading-tight"
                      style={{
                        WebkitLineClamp: 3,
                        display: '-webkit-box',
                        overflow: 'hidden',
                        WebkitBoxOrient: 'vertical',
                        wordBreak: 'break-word',
                      }}
                      data-testid="title-card-title"
                    >
                      {title}
                    </h1>
                    <div
                      className="whitespace-normal text-xs"
                      style={{
                        WebkitLineClamp:
                          !showRequestButton ||
                          (currentStatus &&
                            currentStatus !== MediaStatus.UNKNOWN &&
                            currentStatus !== MediaStatus.DELETED)
                            ? 5
                            : 3,
                        display: '-webkit-box',
                        overflow: 'hidden',
                        WebkitBoxOrient: 'vertical',
                        wordBreak: 'break-word',
                      }}
                    >
                      {summary}
                    </div>
                  </div>
                </div>
              </Link>

              <div className="absolute bottom-0 left-0 right-0 flex justify-between px-2 py-2">
                {showRequestButton &&
                  (!currentStatus ||
                    currentStatus === MediaStatus.UNKNOWN ||
                    currentStatus === MediaStatus.DELETED) && (
                    <Button
                      buttonType="primary"
                      buttonSize="sm"
                      onClick={(e) => {
                        e.preventDefault();
                        setShowRequestModal(true);
                      }}
                      className="h-7 w-full"
                    >
                      <ArrowDownTrayIcon />
                      <span>{intl.formatMessage(globalMessages.request)}</span>
                    </Button>
                  )}
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </div>
  );
};

export default withProperties(TitleCard, { Placeholder, ErrorCard });
