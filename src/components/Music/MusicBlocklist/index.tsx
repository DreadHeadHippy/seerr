import Badge from '@app/components/Common/Badge';
import CachedImage from '@app/components/Common/CachedImage';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { TrashIcon } from '@heroicons/react/24/solid';
import type {
  MusicBlocklistItem,
  MusicBlocklistResponse,
} from '@server/interfaces/api/musicInterfaces';
import axios from 'axios';
import Link from 'next/link';
import { useState } from 'react';
import { FormattedRelativeTime, useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Music.MusicBlocklist', {
  artist: 'Artist',
  blocklistedby: '{date} by {user}',
  empty: 'No artists are blocklisted.',
  hint: 'Blocklisted artists are hidden from the Music page and search for everyone but admins, and cannot be requested. Blocklist an artist from its card on the Music page.',
});

/** The music blocklist, shown on the Blocklist page. Admin only. */
const MusicBlocklist = ({ search }: { search: string }) => {
  const intl = useIntl();
  const { data, error, mutate } = useSWR<MusicBlocklistResponse>(
    '/api/v1/music/blocklist',
    { revalidateOnFocus: false }
  );

  if (error) {
    return (
      <div className="py-24 text-center text-gray-400">
        {intl.formatMessage(globalMessages.blocklistError)}
      </div>
    );
  }

  if (!data) {
    return <LoadingSpinner />;
  }

  const term = search.trim().toLowerCase();
  const results = term
    ? data.results.filter((item) =>
        item.artistName.toLowerCase().includes(term)
      )
    : data.results;

  return (
    <>
      <p className="mb-4 text-sm text-gray-400">
        {intl.formatMessage(messages.hint)}
      </p>
      {results.length === 0 ? (
        <div className="flex w-full flex-col items-center justify-center py-24 text-white">
          <span className="text-2xl text-gray-400">
            {intl.formatMessage(
              data.results.length === 0
                ? messages.empty
                : globalMessages.noresults
            )}
          </span>
        </div>
      ) : (
        results.map((item) => (
          <div className="py-2" key={item.foreignArtistId}>
            <BlocklistedArtist item={item} onRemoved={() => mutate()} />
          </div>
        ))
      )}
    </>
  );
};

const BlocklistedArtist = ({
  item,
  onRemoved,
}: {
  item: MusicBlocklistItem;
  onRemoved: () => void;
}) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [isUpdating, setIsUpdating] = useState(false);

  const remove = async () => {
    setIsUpdating(true);

    try {
      await axios.delete(`/api/v1/music/blocklist/${item.foreignArtistId}`);
      addToast(
        <span>
          {intl.formatMessage(globalMessages.removeFromBlocklistSuccess, {
            title: item.artistName,
            strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
          })}
        </span>,
        { appearance: 'success', autoDismiss: true }
      );
      onRemoved();
    } catch {
      addToast(intl.formatMessage(globalMessages.blocklistError), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="flex w-full flex-col justify-between gap-4 overflow-hidden rounded-xl bg-gray-800 p-4 text-gray-400 shadow-md ring-1 ring-gray-700 xl:flex-row xl:items-center">
      <div className="flex min-w-0 flex-col gap-1 xl:w-1/3">
        <div className="pointer-events-none self-start rounded-full border border-emerald-500 bg-emerald-600/80 shadow-md">
          <div className="flex h-4 items-center px-2 py-2 text-center text-xs font-medium uppercase tracking-wider text-white sm:h-5">
            {intl.formatMessage(messages.artist)}
          </div>
        </div>
        <span className="truncate text-lg font-bold text-white xl:text-xl">
          {item.artistName}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center text-sm">
        <div className="card-field">
          <span className="card-field-name">Status</span>
          <Badge badgeType="danger">
            {intl.formatMessage(globalMessages.blocklisted)}
          </Badge>
        </div>
        <div className="card-field">
          <span className="card-field-name">
            {intl.formatMessage(globalMessages.blocklisted)}
          </span>
          <span className="flex truncate text-sm text-gray-300">
            {intl.formatMessage(messages.blocklistedby, {
              date: (
                <FormattedRelativeTime
                  value={Math.floor(
                    (new Date(item.createdAt).getTime() - Date.now()) / 1000
                  )}
                  updateIntervalInSeconds={1}
                  numeric="auto"
                />
              ),
              user: item.user ? (
                <Link href={`/users/${item.user.id}`}>
                  <span className="group flex items-center truncate">
                    <CachedImage
                      type="avatar"
                      src={item.user.avatar ?? ''}
                      alt=""
                      className="avatar-sm ml-1.5"
                      width={20}
                      height={20}
                      style={{ objectFit: 'cover' }}
                    />
                    <span className="ml-1 truncate text-sm font-semibold group-hover:text-white group-hover:underline">
                      {item.user.displayName}
                    </span>
                  </span>
                </Link>
              ) : (
                <span className="ml-1 truncate text-sm font-semibold">???</span>
              ),
            })}
          </span>
        </div>
      </div>

      <div className="flex w-full flex-col justify-center xl:w-96 xl:items-end">
        <ConfirmButton
          onClick={remove}
          confirmText={intl.formatMessage(
            isUpdating ? globalMessages.deleting : globalMessages.areyousure
          )}
          className={`w-full ${
            isUpdating ? 'pointer-events-none opacity-50' : ''
          }`}
        >
          <TrashIcon />
          <span>{intl.formatMessage(globalMessages.removefromBlocklist)}</span>
        </ConfirmButton>
      </div>
    </div>
  );
};

export default MusicBlocklist;
