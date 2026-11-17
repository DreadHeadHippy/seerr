import CachedImage from '@app/components/Common/CachedImage';
import defineMessages from '@app/utils/defineMessages';
import type { StorageItem, StorageUsage } from '@server/lib/storage';
import type { MovieDetails } from '@server/models/Movie';
import type { TvDetails } from '@server/models/Tv';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.UserProfile.StorageUsage', {
  storage: 'Storage',
  used: '{used} of {limit} used',
  usedUnlimited: '{used} used',
  full: 'Storage limit reached. Delete something you requested to make room for new requests.',
  shared: 'shared',
  seasons: '{count, plural, one {Season {list}} other {Seasons {list}}}',
  nothing: 'Nothing you requested is taking up space yet.',
  howToDelete: 'Open a title to delete it or ask for it to be deleted.',
});

const GB = 1024 ** 3;

const formatSize = (bytes: number): string =>
  bytes >= 100 * GB
    ? `${Math.round(bytes / GB)} GB`
    : bytes >= GB
      ? `${(bytes / GB).toFixed(1)} GB`
      : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;

const StorageRow = ({ item }: { item: StorageItem }) => {
  const intl = useIntl();
  const { data } = useSWR<MovieDetails | TvDetails>(
    `/api/v1/${item.mediaType}/${item.tmdbId}`
  );
  const title = data ? ('title' in data ? data.title : data.name) : '';

  return (
    <li>
      <Link
        href={`/${item.mediaType}/${item.tmdbId}`}
        className="flex items-center gap-3 rounded-md p-2 transition hover:bg-gray-700/50"
      >
        <div className="relative h-12 w-8 flex-shrink-0 overflow-hidden rounded bg-gray-700">
          {data?.posterPath && (
            <CachedImage
              type="tmdb"
              src={`https://image.tmdb.org/t/p/w92${data.posterPath}`}
              alt=""
              fill
              style={{ objectFit: 'cover' }}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-white">{title}</div>
          {item.seasons && (
            <div className="truncate text-sm text-gray-400">
              {intl.formatMessage(messages.seasons, {
                count: item.seasons.length,
                list: item.seasons.join(', '),
              })}
            </div>
          )}
        </div>
        <div className="flex-shrink-0 text-right text-sm">
          <div className="font-semibold text-white">
            {formatSize(item.bytes)}
          </div>
          {item.shared && (
            <div className="text-xs text-gray-400">
              {intl.formatMessage(messages.shared)}
            </div>
          )}
        </div>
      </Link>
    </li>
  );
};

/**
 * What a user's requests take up on disk, against their storage limit, and
 * the titles behind it, biggest first.
 */
const StorageUsageCard = ({ userId }: { userId: number }) => {
  const intl = useIntl();
  const { data } = useSWR<StorageUsage & { deletionMode: string }>(
    `/api/v1/user/${userId}/storage`
  );

  if (!data) {
    return null;
  }

  const fraction = data.limitBytes
    ? Math.min(1, data.usedBytes / data.limitBytes)
    : 0;

  return (
    <div
      className={`mt-5 overflow-hidden rounded-lg bg-gray-800/50 px-4 py-5 shadow ring-1 sm:p-6 ${
        data.restricted
          ? 'bg-gradient-to-t from-red-900 to-transparent ring-red-500'
          : 'ring-gray-700'
      }`}
    >
      <div className="flex items-baseline justify-between gap-4">
        <h3
          className={`text-sm font-bold ${
            data.restricted ? 'text-red-500' : 'text-gray-300'
          }`}
        >
          {intl.formatMessage(messages.storage)}
        </h3>
        <span className="text-sm text-gray-300">
          {data.limitBytes
            ? intl.formatMessage(messages.used, {
                used: formatSize(data.usedBytes),
                limit: formatSize(data.limitBytes),
              })
            : intl.formatMessage(messages.usedUnlimited, {
                used: formatSize(data.usedBytes),
              })}
        </span>
      </div>
      {data.limitBytes !== undefined && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-700">
          <div
            className={`h-full rounded-full ${
              data.restricted
                ? 'bg-red-500'
                : fraction > 0.8
                  ? 'bg-amber-500'
                  : 'bg-indigo-500'
            }`}
            style={{ width: `${Math.round(fraction * 100)}%` }}
          />
        </div>
      )}
      {data.restricted && (
        <p className="mt-3 text-sm text-red-400">
          {intl.formatMessage(messages.full)}
        </p>
      )}
      {data.items.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400">
          {intl.formatMessage(messages.nothing)}
        </p>
      ) : (
        <>
          {data.deletionMode !== 'none' && (
            <p className="mt-3 text-sm text-gray-400">
              {intl.formatMessage(messages.howToDelete)}
            </p>
          )}
          <ul className="mt-3 max-h-96 space-y-1 overflow-y-auto">
            {data.items.map((item) => (
              <StorageRow
                key={`${item.mediaType}-${item.mediaId}`}
                item={item}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
};

export default StorageUsageCard;
