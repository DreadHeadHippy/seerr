import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import StatusBadgeMini from '@app/components/Common/StatusBadgeMini';
import { MusicEtaPill } from '@app/components/Music/MusicEta';
import MusicRequestModal from '@app/components/RequestModal/MusicRequestModal';
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
import type { MusicAlbumResult } from '@server/interfaces/api/musicInterfaces';
import { Fragment, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Music.AlbumCard', {
  album: 'Album',
  ep: 'EP',
  single: 'Single',
  monitored: 'Monitored',
  openInLidarr: 'Open in Lidarr',
});

const TYPE_MESSAGES: Record<string, keyof typeof messages> = {
  Album: 'album',
  EP: 'ep',
  Single: 'single',
};

interface AlbumCardProps {
  album: MusicAlbumResult;
  /** Fills its grid cell instead of the fixed slider width. */
  canExpand?: boolean;
}

/**
 * MusicBrainz dates can be a full date, a year and month, or just a year.
 */
const releaseDateOptions = (
  date: string
): Intl.DateTimeFormatOptions | undefined =>
  /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? { month: 'short', day: 'numeric', year: 'numeric' }
    : /^\d{4}-\d{2}$/.test(date)
      ? { month: 'short', year: 'numeric' }
      : /^\d{4}$/.test(date)
        ? { year: 'numeric' }
        : undefined;

const AlbumCard = ({
  album: initialAlbum,
  canExpand = false,
}: AlbumCardProps) => {
  const intl = useIntl();
  const isTouch = useIsTouch();
  const { hasPermission } = useUser();
  const [album, setAlbum] = useState(initialAlbum);
  const [showDetail, setShowDetail] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const canRequest = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_MUSIC],
    { type: 'or' }
  );

  const status = album.hasFiles
    ? MediaStatus.AVAILABLE
    : album.inLidarr
      ? MediaStatus.PROCESSING
      : undefined;

  const coverUrl = imageFailed ? undefined : album.coverUrl;
  const typeMessage = TYPE_MESSAGES[album.albumType];
  const dateOptions = releaseDateOptions(album.releaseDate);

  return (
    <div className={canExpand ? 'w-full' : 'w-36 sm:w-36 md:w-44'}>
      <MusicRequestModal
        show={showRequestModal}
        album={album}
        onComplete={(result) => {
          setAlbum({ ...album, ...result, inLidarr: true, monitored: true });
          setShowRequestModal(false);
        }}
        onCancel={() => setShowRequestModal(false)}
      />
      <div
        className={`relative transform-gpu cursor-default overflow-hidden rounded-xl bg-gray-800 outline-none ring-1 transition duration-300 ${
          showDetail
            ? 'scale-105 shadow-lg ring-gray-500'
            : 'scale-100 shadow ring-gray-700'
        }`}
        style={{ paddingBottom: '150%' }}
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
        <div className="absolute inset-0 flex h-full w-full flex-col overflow-hidden">
          <div className="relative aspect-square w-full flex-shrink-0 bg-gray-900">
            <CachedImage
              type="music"
              className="absolute inset-0 h-full w-full"
              alt=""
              src={coverUrl ?? '/images/seerr_poster_not_found_logo_center.png'}
              onError={() => setImageFailed(true)}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              fill
            />
          </div>
          <div className="flex min-h-0 flex-1 flex-col justify-center px-2 py-1 text-white">
            <div
              className="whitespace-normal text-sm font-bold leading-tight"
              style={{
                WebkitLineClamp: 2,
                display: '-webkit-box',
                overflow: 'hidden',
                WebkitBoxOrient: 'vertical',
                wordBreak: 'break-word',
              }}
            >
              {album.title}
            </div>
            <div className="truncate text-xs text-gray-300">
              {album.artistName}
            </div>
            {dateOptions && (
              <div className="truncate text-xs text-gray-400">
                {intl.formatDate(
                  // Pad partial dates; only the parts in dateOptions show.
                  `${album.releaseDate.padEnd(10, '-01').slice(0, 10)}T00:00:00`,
                  dateOptions
                )}
              </div>
            )}
          </div>
          <div className="absolute left-0 right-0 top-0 flex items-center justify-between p-2">
            <div className="pointer-events-none z-40 self-start rounded-full border border-teal-500 bg-teal-600/80 shadow-md">
              <div className="flex h-4 items-center px-2 py-2 text-center text-xs font-medium uppercase tracking-wider text-white sm:h-5">
                {typeMessage
                  ? intl.formatMessage(messages[typeMessage])
                  : album.albumType}
              </div>
            </div>
            {status && (
              <div className="flex flex-col items-end gap-1">
                <div className="pointer-events-none z-40 flex">
                  <StatusBadgeMini
                    status={status}
                    inProgress={!!initialAlbum.download}
                    shrink
                  />
                </div>
                <MusicEtaPill download={initialAlbum.download} />
              </div>
            )}
          </div>

          <Transition
            as={Fragment}
            show={showDetail || showRequestModal}
            enter="transition-opacity"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div
              className="absolute inset-0 overflow-hidden rounded-xl"
              style={{
                background:
                  'linear-gradient(180deg, rgba(45, 55, 72, 0.2) 0%, rgba(45, 55, 72, 0.9) 100%)',
              }}
            >
              <div className="absolute bottom-0 left-0 right-0 flex justify-between px-2 py-2">
                {!album.inLidarr && canRequest && (
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
                {album.inLidarr &&
                  (album.lidarrUrl ? (
                    <Button
                      as="a"
                      href={album.lidarrUrl}
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
                      <span>{intl.formatMessage(messages.monitored)}</span>
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

export default AlbumCard;
