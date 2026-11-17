import CachedImage from '@app/components/Common/CachedImage';
import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import { meterColor } from '@app/components/Common/StorageMeter';
import DeleteOwnMedia from '@app/components/DeleteOwnMedia';
import useMyStorage from '@app/hooks/useMyStorage';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { formatSize } from '@app/utils/formatSize';
import { MediaStatus } from '@server/constants/media';
import type { StorageItem } from '@server/lib/storage';
import type { MovieDetails } from '@server/models/Movie';
import type { TvDetails } from '@server/models/Tv';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

export const myMediaMessages = defineMessages('components.MyMedia', {
  myMedia: 'My Media',
  subtext: 'Everything you requested.',
  storage: 'Your Storage',
  usedOf: '{used} used of {limit}',
  usedUnlimited: '{used} used',
  left: '{left} left',
  full: "Your storage is full. Delete something you've finished watching to request more.",
  directHelp:
    'Finished watching something? Press Delete under it to remove it and free up space.',
  requestHelp:
    'Finished watching something? Press Ask to Delete under it and an admin will remove it.',
  sharedHelp: 'Shared titles were requested by someone else too.',
  shared: 'Shared',
  seasons: '{count, plural, one {Season {list}} other {Seasons {list}}}',
  nothing: "You haven't requested anything yet.",
});

const MyMediaCard = ({
  item,
  onDeleted,
}: {
  item: StorageItem;
  onDeleted: () => void;
}) => {
  const intl = useIntl();
  const { data } = useSWR<MovieDetails | TvDetails>(
    `/api/v1/${item.mediaType}/${item.tmdbId}`
  );
  const title = data ? ('title' in data ? data.title : data.name) : '';
  const status =
    item.status === MediaStatus.AVAILABLE
      ? globalMessages.available
      : item.status === MediaStatus.PARTIALLY_AVAILABLE
        ? globalMessages.partiallyavailable
        : item.status === MediaStatus.PROCESSING
          ? globalMessages.processing
          : undefined;

  return (
    <li className="flex flex-col overflow-hidden rounded-xl bg-gray-800 ring-1 ring-gray-700">
      <Link href={`/${item.mediaType}/${item.tmdbId}`} className="block">
        <div
          className="relative w-full bg-gray-700"
          style={{ paddingBottom: '150%' }}
        >
          {data?.posterPath && (
            <CachedImage
              type="tmdb"
              src={`https://image.tmdb.org/t/p/w300_and_h450_face${data.posterPath}`}
              alt=""
              fill
              style={{ objectFit: 'cover' }}
            />
          )}
        </div>
      </Link>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <Link
          href={`/${item.mediaType}/${item.tmdbId}`}
          className="line-clamp-2 font-semibold leading-tight text-white hover:underline"
        >
          {title}
        </Link>
        {item.seasons && (
          <div className="text-sm text-gray-400">
            {intl.formatMessage(myMediaMessages.seasons, {
              count: item.seasons.length,
              list: item.seasons.join(', '),
            })}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="font-semibold text-white">
            {formatSize(item.bytes)}
          </span>
          {item.shared && (
            <span className="text-gray-400">
              · {intl.formatMessage(myMediaMessages.shared)}
            </span>
          )}
          {status && (
            <span className="text-gray-400">
              · {intl.formatMessage(status)}
            </span>
          )}
        </div>
        <div className="mt-auto pt-2">
          <DeleteOwnMedia
            mediaId={item.mediaId}
            status={item.status}
            title={title}
            backdropPath={data?.backdropPath}
            onDeleted={onDeleted}
            block
          />
        </div>
      </div>
    </li>
  );
};

/**
 * Everything the signed-in user requested, biggest first, with their
 * storage use on top and a plain Delete / Ask to Delete button under each
 * title, so freeing up space doesn't mean hunting for anything.
 */
const MyMedia = () => {
  const intl = useIntl();
  const { data, mutate } = useMyStorage();
  const title = intl.formatMessage(myMediaMessages.myMedia);
  const fraction = data?.limitBytes
    ? Math.min(1, data.usedBytes / data.limitBytes)
    : 0;

  return (
    <>
      <PageTitle title={title} />
      <div className="mb-6">
        <Header subtext={intl.formatMessage(myMediaMessages.subtext)}>
          {title}
        </Header>
      </div>
      {!data && <LoadingSpinner />}
      {data && (
        <>
          <section
            className={`mb-6 rounded-xl p-5 ring-1 ${
              data.restricted
                ? 'bg-red-900/40 ring-red-500'
                : 'bg-gray-800/60 ring-gray-700'
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg font-bold text-white">
                {intl.formatMessage(myMediaMessages.storage)}
              </h3>
              <span className="text-lg text-gray-200">
                {data.limitBytes
                  ? intl.formatMessage(myMediaMessages.usedOf, {
                      used: formatSize(data.usedBytes),
                      limit: formatSize(data.limitBytes),
                    })
                  : intl.formatMessage(myMediaMessages.usedUnlimited, {
                      used: formatSize(data.usedBytes),
                    })}
              </span>
            </div>
            {data.limitBytes !== undefined && (
              <>
                <div className="mt-3 h-4 overflow-hidden rounded-full bg-gray-700">
                  <div
                    className={`h-full rounded-full ${meterColor(
                      fraction,
                      data.restricted
                    )}`}
                    style={{
                      width: `${Math.max(2, Math.round(fraction * 100))}%`,
                    }}
                  />
                </div>
                <p
                  className={`mt-2 ${
                    data.restricted
                      ? 'font-medium text-red-300'
                      : 'text-gray-300'
                  }`}
                >
                  {data.restricted
                    ? intl.formatMessage(myMediaMessages.full)
                    : intl.formatMessage(myMediaMessages.left, {
                        left: formatSize(data.limitBytes - data.usedBytes),
                      })}
                </p>
              </>
            )}
            {data.items.length > 0 && data.deletionMode !== 'none' && (
              <p className="mt-3 text-gray-300">
                {intl.formatMessage(
                  data.deletionMode === 'direct'
                    ? myMediaMessages.directHelp
                    : myMediaMessages.requestHelp
                )}
                {data.items.some((item) => item.shared) && (
                  <> {intl.formatMessage(myMediaMessages.sharedHelp)}</>
                )}
              </p>
            )}
          </section>
          {data.items.length === 0 ? (
            <div className="mt-16 text-center text-xl text-gray-400">
              {intl.formatMessage(myMediaMessages.nothing)}
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {data.items.map((item) => (
                <MyMediaCard
                  key={item.mediaId}
                  item={item}
                  onDeleted={() => mutate()}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
};

export default MyMedia;
