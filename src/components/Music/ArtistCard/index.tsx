import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import StatusBadgeMini from '@app/components/Common/StatusBadgeMini';
import ArtistRequestModal from '@app/components/RequestModal/ArtistRequestModal';
import { useIsTouch } from '@app/hooks/useIsTouch';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import {
  ArrowDownTrayIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline';
import { MediaStatus } from '@server/constants/media';
import type { MusicArtistResult } from '@server/interfaces/api/musicInterfaces';
import { Fragment, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Music.ArtistCard', {
  artist: 'Artist',
  inLidarr: 'In Lidarr',
  openInLidarr: 'Open in Lidarr',
  albums: '{count, plural, one {# Album} other {# Albums}}',
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
  const [artist, setArtist] = useState(initialArtist);
  const [showDetail, setShowDetail] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const posterUrl = imageFailed ? undefined : artist.posterUrl;

  const showRequestButton = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_MUSIC],
    { type: 'or' }
  );

  const status = artist.inLidarr
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
      <ArtistRequestModal
        show={showRequestModal}
        artist={artist}
        onComplete={(added) => {
          setArtist({ ...artist, ...added, inLidarr: true });
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
            {status && (
              <div className="flex flex-col items-center gap-1">
                <div className="pointer-events-none z-40 flex">
                  <StatusBadgeMini status={status} shrink />
                </div>
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
              <div
                className="absolute inset-0 h-full w-full overflow-hidden text-left"
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
              </div>

              <div className="absolute bottom-0 left-0 right-0 flex justify-between px-2 py-2">
                {!artist.inLidarr && showRequestButton && (
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
        </div>
      </div>
    </div>
  );
};

export default ArtistCard;
