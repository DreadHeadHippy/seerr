import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import Tag from '@app/components/Common/Tag';
import Tooltip from '@app/components/Common/Tooltip';
import AlbumCard from '@app/components/Music/AlbumCard';
import { useMusicEta } from '@app/components/Music/MusicEta';
import {
  MusicPreviewProvider,
  useMusicPreview,
} from '@app/components/Music/PreviewPlayer';
import MusicRequestModal from '@app/components/RequestModal/MusicRequestModal';
import useArtistBlocklist from '@app/hooks/useArtistBlocklist';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import {
  ArrowDownTrayIcon,
  ArrowTopRightOnSquareIcon,
  EyeIcon,
  EyeSlashIcon,
} from '@heroicons/react/24/outline';
import { PauseIcon, PlayIcon } from '@heroicons/react/24/solid';
import type {
  MusicAlbumResult,
  MusicArtistDetails,
  MusicArtistResult,
} from '@server/interfaces/api/musicInterfaces';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Music.ArtistDetails', {
  biography: 'Biography',
  biographyUnavailable: 'Biography unavailable.',
  showMore: 'Show More',
  showLess: 'Show Less',
  inLidarr: 'In Lidarr',
  openInLidarr: 'Open in Lidarr',
  playTopSongs: 'Play Top Songs',
  pause: 'Pause',
  type: 'Type',
  releases: '{count, plural, one {# Release} other {# Releases}}',
  links: 'Links',
  discography: 'Discography',
  noReleases: 'No releases found for this artist.',
  albums: 'Albums',
  eps: 'EPs',
  singles: 'Singles',
  live: 'Live',
  compilations: 'Compilations',
  remixes: 'Remixes',
  other: 'Other',
});

type SectionKey =
  | 'albums'
  | 'eps'
  | 'singles'
  | 'live'
  | 'compilations'
  | 'remixes'
  | 'other';

const SECTION_ORDER: SectionKey[] = [
  'albums',
  'eps',
  'singles',
  'live',
  'compilations',
  'remixes',
  'other',
];

/** Groups releases the way musicbrainz.org does: studio work first. */
const sectionOf = (release: MusicAlbumResult): SectionKey => {
  const secondary = release.secondaryTypes ?? [];

  if (secondary.includes('Live')) return 'live';
  if (secondary.includes('Compilation')) return 'compilations';
  if (secondary.includes('Remix')) return 'remixes';
  if (secondary.length > 0) return 'other';

  switch (release.albumType) {
    case 'Album':
      return 'albums';
    case 'EP':
      return 'eps';
    case 'Single':
      return 'singles';
    default:
      return 'other';
  }
};

/** Bios longer than this are collapsed behind "Show More". */
const BIO_PREVIEW_LENGTH = 600;

const ArtistDetailsContent = ({ details }: { details: MusicArtistDetails }) => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const preview = useMusicPreview();
  const [artist, setArtist] = useState<MusicArtistResult>(details.artist);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [showFullBio, setShowFullBio] = useState(false);
  const {
    blocklisted,
    isUpdating: isBlocklistUpdating,
    toggle: toggleBlocklist,
  } = useArtistBlocklist(details.artist);

  const eta = useMusicEta(blocklisted ? undefined : details.artist.download);
  const isAdmin = hasPermission(Permission.ADMIN);
  const canRequest = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_MUSIC],
    { type: 'or' }
  );
  const isPreviewArtist = preview?.artistName === artist.artistName;
  const isPreviewPlaying = isPreviewArtist && preview?.isPlaying;

  const sections = SECTION_ORDER.map((key) => ({
    key,
    releases: details.releases.filter((release) => sectionOf(release) === key),
  })).filter((section) => section.releases.length > 0);

  const bio = artist.overview?.trim() ?? '';
  const bioIsLong = bio.length > BIO_PREVIEW_LENGTH;
  const shownBio =
    bioIsLong && !showFullBio
      ? `${bio.slice(0, BIO_PREVIEW_LENGTH).trimEnd()}…`
      : bio;

  const attributes = [
    artist.disambiguation,
    artist.genres.slice(0, 3).join(', '),
    intl.formatMessage(messages.releases, { count: details.releases.length }),
  ].filter(Boolean);

  return (
    <div className="media-page" style={{ height: 493 }}>
      {artist.fanartUrl && (
        <div className="media-page-bg-image">
          <CachedImage
            type="music"
            alt=""
            src={artist.fanartUrl}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            fill
            priority
          />
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(180deg, rgba(17, 24, 39, 0.47) 0%, rgba(17, 24, 39, 1) 100%)',
            }}
          />
        </div>
      )}
      <PageTitle title={artist.artistName} />
      <MusicRequestModal
        show={showRequestModal}
        artist={artist}
        onComplete={(added) => {
          const updated = { ...artist, ...added, inLidarr: true };
          setArtist(updated);
          preview?.markAdded(updated);
          setShowRequestModal(false);
        }}
        onCancel={() => setShowRequestModal(false)}
      />
      <div className="media-header">
        <div className="media-poster">
          <CachedImage
            type="music"
            src={artist.posterUrl ?? '/images/seerr_poster_not_found.png'}
            alt=""
            sizes="100vw"
            style={{ width: '100%', height: 'auto', aspectRatio: '2 / 3' }}
            className="object-cover"
            width={600}
            height={900}
            priority
          />
        </div>
        <div className="media-title">
          <div className="media-status">
            {blocklisted ? (
              <Badge badgeType="danger">
                {intl.formatMessage(globalMessages.blocklisted)}
              </Badge>
            ) : (
              artist.inLidarr && (
                <Badge badgeType="success">
                  {intl.formatMessage(messages.inLidarr)}
                </Badge>
              )
            )}
            {eta && (
              <Badge badgeType="primary" className="ml-2">
                {eta.full}
              </Badge>
            )}
          </div>
          <h1 data-testid="media-title">{artist.artistName}</h1>
          <span className="media-attributes">
            {attributes.map((attribute, index) => (
              <span key={index}>
                {index > 0 && <span className="mx-1">|</span>}
                {attribute}
              </span>
            ))}
          </span>
        </div>
        <div className="media-actions">
          {isAdmin && !artist.inLidarr && (
            <Tooltip
              content={intl.formatMessage(
                blocklisted
                  ? globalMessages.removefromBlocklist
                  : globalMessages.addToBlocklist
              )}
            >
              <Button
                buttonType="ghost"
                className={`z-40 mr-2 ${
                  isBlocklistUpdating ? 'pointer-events-none opacity-50' : ''
                }`}
                buttonSize="md"
                onClick={() => toggleBlocklist()}
              >
                {blocklisted ? <EyeIcon /> : <EyeSlashIcon />}
              </Button>
            </Tooltip>
          )}
          {preview && !blocklisted && (
            <Button
              buttonType="ghost"
              className="mr-2"
              onClick={() => preview.playArtist(artist)}
            >
              {isPreviewPlaying ? <PauseIcon /> : <PlayIcon />}
              <span>
                {intl.formatMessage(
                  isPreviewPlaying ? messages.pause : messages.playTopSongs
                )}
              </span>
            </Button>
          )}
          {!artist.inLidarr && !blocklisted && canRequest && (
            <Button
              buttonType="primary"
              onClick={() => setShowRequestModal(true)}
            >
              <ArrowDownTrayIcon />
              <span>{intl.formatMessage(globalMessages.request)}</span>
            </Button>
          )}
          {artist.inLidarr && artist.lidarrUrl && (
            <Button
              as="a"
              href={artist.lidarrUrl}
              target="_blank"
              rel="noreferrer"
              buttonType="ghost"
            >
              <ArrowTopRightOnSquareIcon />
              <span>{intl.formatMessage(messages.openInLidarr)}</span>
            </Button>
          )}
        </div>
      </div>
      <div className="media-overview">
        <div className="media-overview-left">
          <h2>{intl.formatMessage(messages.biography)}</h2>
          <p className="whitespace-pre-line">
            {shownBio || intl.formatMessage(messages.biographyUnavailable)}
          </p>
          {bioIsLong && (
            <button
              type="button"
              className="mt-2 text-sm text-indigo-400 transition hover:text-indigo-300"
              onClick={() => setShowFullBio(!showFullBio)}
            >
              {intl.formatMessage(
                showFullBio ? messages.showLess : messages.showMore
              )}
            </button>
          )}
          {artist.genres.length > 0 && (
            <div className="mt-6">
              {artist.genres.map((genre) => (
                <span key={genre} className="mb-2 mr-2 inline-flex last:mr-0">
                  <Tag>{genre}</Tag>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="media-overview-right">
          <div className="media-facts">
            {artist.artistType && (
              <div className="media-fact">
                <span>{intl.formatMessage(messages.type)}</span>
                <span className="media-fact-value">{artist.artistType}</span>
              </div>
            )}
            {details.artist.links.length > 0 && (
              <div className="media-fact">
                <span>{intl.formatMessage(messages.links)}</span>
                <span className="media-fact-value">
                  {details.artist.links.map((link) => (
                    <a
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block capitalize hover:text-white hover:underline"
                    >
                      {link.name}
                    </a>
                  ))}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8">
        {sections.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            {intl.formatMessage(messages.noReleases)}
          </div>
        ) : (
          sections.map((section) => (
            <div key={section.key} className="mb-8">
              <div className="slider-header">
                <div className="slider-title">
                  <span>
                    {intl.formatMessage(messages[section.key])}{' '}
                    <span className="text-gray-500">
                      ({section.releases.length})
                    </span>
                  </span>
                </div>
              </div>
              <ul className="cards-vertical">
                {section.releases.map((release) => (
                  <li key={release.foreignAlbumId}>
                    <AlbumCard album={release} canExpand />
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

/** An artist's page: bio, links and discography, like a movie or series. */
const ArtistDetails = () => {
  const router = useRouter();
  const foreignArtistId = router.query.foreignArtistId as string | undefined;
  const { data, error } = useSWR<MusicArtistDetails>(
    foreignArtistId ? `/api/v1/music/artist/${foreignArtistId}` : null,
    {
      revalidateOnFocus: false,
      // Keep the ETAs (and statuses) current while something downloads.
      refreshInterval: (latest) =>
        latest?.artist.download ||
        latest?.releases.some((release) => release.download)
          ? 60 * 1000
          : 0,
    }
  );

  if (error) {
    return (
      <ErrorPage statusCode={error.response?.status === 404 ? 404 : 500} />
    );
  }

  if (!data) {
    return <LoadingSpinner />;
  }

  return (
    <MusicPreviewProvider>
      <ArtistDetailsContent key={foreignArtistId} details={data} />
    </MusicPreviewProvider>
  );
};

export default ArtistDetails;
