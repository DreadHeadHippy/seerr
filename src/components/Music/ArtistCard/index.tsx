import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import StatusBadgeMini from '@app/components/Common/StatusBadgeMini';
import { MusicEtaPill } from '@app/components/Music/MusicEta';
import { useMusicPreview } from '@app/components/Music/PreviewPlayer';
import MusicRequestModal from '@app/components/RequestModal/MusicRequestModal';
import useArtistBlocklist from '@app/hooks/useArtistBlocklist';
import { useIsTouch } from '@app/hooks/useIsTouch';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  EyeIcon,
  EyeSlashIcon,
} from '@heroicons/react/24/outline';
import { PauseIcon, PlayIcon } from '@heroicons/react/24/solid';
import { MediaStatus } from '@server/constants/media';
import type { MusicArtistResult } from '@server/interfaces/api/musicInterfaces';
import Link from 'next/link';
import { Fragment, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Music.ArtistCard', {
  artist: 'Artist',
  inLidarr: 'In Lidarr',
  openInLidarr: 'Open in Lidarr',
  albums: '{count, plural, one {# Album} other {# Albums}}',
  playTopSongs: 'Play Top Songs',
  pausePreview: 'Pause',
});

interface ArtistCardProps {
  artist: MusicArtistResult;
  canExpand?: boolean;
}

const ArtistCard = ({
  artist: initialArtist,
  canExpand = false,
}: ArtistCardProps) => {
  const intl = useIntl();
  const isTouch = useIsTouch();
  const { hasPermission } = useUser();
  const [localArtist, setLocalArtist] = useState(initialArtist);
  // Only admins are sent blocklisted artists (in search), or can block one.
  const {
    blocklisted,
    isUpdating: isBlocklistUpdating,
    toggle: toggleBlocklist,
  } = useArtistBlocklist(initialArtist);
  const isAdmin = hasPermission(Permission.ADMIN);
  const [showDetail, setShowDetail] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const preview = useMusicPreview();
  // Requested from the player, or from another card for the same artist.
  const artist =
    preview?.addedArtists[localArtist.foreignArtistId] ?? localArtist;
  const posterUrl = imageFailed ? undefined : artist.posterUrl;
  const isPreviewArtist = preview?.artistName === artist.artistName;
  const isPreviewPlaying = isPreviewArtist && preview?.isPlaying;
  const isPreviewLoading = preview?.loadingArtist === artist.artistName;

  const showRequestButton = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_MUSIC],
    { type: 'or' }
  );

  const status = blocklisted
    ? MediaStatus.BLOCKLISTED
    : artist.inLidarr
      ? (artist.trackFileCount ?? 0) > 0
        ? MediaStatus.AVAILABLE
        : MediaStatus.PROCESSING
      : undefined;

  const subtitle = [
    artist.disambiguation,
    artist.albumCount
      ? intl.formatMessage(messages.albums, { count: artist.albumCount })
      : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={canExpand ? 'w-full' : 'w-36 sm:w-36 md:w-44'}>
      <MusicRequestModal
        show={showRequestModal}
        artist={artist}
        onComplete={(added) => {
          const updated = { ...artist, ...added, inLidarr: true };
          setLocalArtist(updated);
          preview?.markAdded(updated);
          setShowRequestModal(false);
        }}
        onCancel={() => setShowRequestModal(false)}
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
            type="music"
            className="absolute inset-0 h-full w-full"
            alt=""
            src={posterUrl ?? '/images/seerr_poster_not_found_logo_top.png'}
            onError={() => setImageFailed(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            fill
          />
          <div className="absolute left-0 right-0 flex items-center justify-between p-2">
            <div className="pointer-events-none z-40 self-start rounded-full border border-emerald-500 bg-emerald-600/80 shadow-md">
              <div className="flex h-4 items-center px-2 py-2 text-center text-xs font-medium uppercase tracking-wider text-white sm:h-5">
                {intl.formatMessage(messages.artist)}
              </div>
            </div>
            {/* Same place and style as the movie and series cards. */}
            {isAdmin && showDetail && !artist.inLidarr && (
              <div className="flex flex-col gap-1">
                <Button
                  buttonType="ghost"
                  buttonSize="sm"
                  className={`z-40 ${
                    isBlocklistUpdating ? 'pointer-events-none opacity-50' : ''
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleBlocklist();
                  }}
                  title={intl.formatMessage(
                    blocklisted
                      ? globalMessages.removefromBlocklist
                      : globalMessages.addToBlocklist
                  )}
                  aria-label={intl.formatMessage(
                    blocklisted
                      ? globalMessages.removefromBlocklist
                      : globalMessages.addToBlocklist
                  )}
                >
                  {blocklisted ? (
                    <EyeIcon className="h-3" />
                  ) : (
                    <EyeSlashIcon className="h-3" />
                  )}
                </Button>
              </div>
            )}
            {status && (
              <div className="flex flex-col items-end gap-1">
                <div className="pointer-events-none z-40 flex">
                  <StatusBadgeMini
                    status={status}
                    inProgress={!blocklisted && !!initialArtist.download}
                    shrink
                  />
                </div>
                {!blocklisted && (
                  <MusicEtaPill download={initialArtist.download} />
                )}
              </div>
            )}
          </div>

          <Transition
            as={Fragment}
            show={!posterUrl || showDetail || showRequestModal}
            enter="transition-opacity"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="absolute inset-0 overflow-hidden rounded-xl">
              <Link
                href={`/music/artist/${artist.foreignArtistId}`}
                className="absolute inset-0 h-full w-full cursor-pointer overflow-hidden text-left"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(45, 55, 72, 0.4) 0%, rgba(45, 55, 72, 0.9) 100%)',
                }}
              >
                <div className="flex h-full w-full items-end">
                  <div className="px-2 pb-11 text-white">
                    {subtitle && (
                      <div className="text-sm font-medium">{subtitle}</div>
                    )}
                    <h1
                      className="whitespace-normal text-xl font-bold leading-tight"
                      style={{
                        WebkitLineClamp: 3,
                        display: '-webkit-box',
                        overflow: 'hidden',
                        WebkitBoxOrient: 'vertical',
                        wordBreak: 'break-word',
                      }}
                    >
                      {artist.artistName}
                    </h1>
                    <div
                      className="whitespace-normal text-xs"
                      style={{
                        WebkitLineClamp: 3,
                        display: '-webkit-box',
                        overflow: 'hidden',
                        WebkitBoxOrient: 'vertical',
                        wordBreak: 'break-word',
                      }}
                    >
                      {artist.overview}
                    </div>
                  </div>
                </div>
              </Link>

              <div className="absolute bottom-0 left-0 right-0 flex justify-between px-2 py-2">
                {!artist.inLidarr && !blocklisted && showRequestButton && (
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
                {artist.inLidarr &&
                  (artist.lidarrUrl ? (
                    <Button
                      as="a"
                      href={artist.lidarrUrl}
                      target="_blank"
                      rel="noreferrer"
                      buttonType="ghost"
                      buttonSize="sm"
                      className="h-7 w-full"
                    >
                      <ArrowTopRightOnSquareIcon />
                      <span>{intl.formatMessage(messages.openInLidarr)}</span>
                    </Button>
                  ) : (
                    <Button
                      buttonType="ghost"
                      buttonSize="sm"
                      className="h-7 w-full"
                      disabled
                    >
                      <span>{intl.formatMessage(messages.inLidarr)}</span>
                    </Button>
                  ))}
              </div>
            </div>
          </Transition>

          {preview && (
            <Transition
              as={Fragment}
              show={
                showDetail ||
                showRequestModal ||
                isPreviewArtist ||
                isPreviewLoading
              }
              enter="transition-opacity"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="transition-opacity"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <button
                type="button"
                className={`absolute left-1/2 top-[35%] z-40 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-white shadow-lg ring-1 ring-white/40 backdrop-blur transition duration-150 hover:scale-110 hover:bg-indigo-600 ${
                  isPreviewArtist ? 'bg-indigo-600' : 'bg-gray-900/70'
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  preview.playArtist(artist);
                }}
                onKeyDown={(e) => e.stopPropagation()}
                aria-label={intl.formatMessage(
                  isPreviewPlaying
                    ? messages.pausePreview
                    : messages.playTopSongs
                )}
                title={intl.formatMessage(
                  isPreviewPlaying
                    ? messages.pausePreview
                    : messages.playTopSongs
                )}
              >
                {isPreviewLoading ? (
                  <ArrowPathIcon className="h-6 w-6 animate-spin" />
                ) : isPreviewPlaying ? (
                  <PauseIcon className="h-6 w-6" />
                ) : (
                  <PlayIcon className="ml-0.5 h-6 w-6" />
                )}
              </button>
            </Transition>
          )}
        </div>
      </div>
    </div>
  );
};

export default ArtistCard;
