import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { CheckIcon, XMarkIcon } from '@heroicons/react/24/solid';
import type { SerializedDeletionRequest } from '@server/interfaces/api/deletionInterfaces';
import type { MovieDetails } from '@server/models/Movie';
import type { TvDetails } from '@server/models/Tv';
import axios from 'axios';
import Link from 'next/link';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.RequestList.DeletionRequests', {
  deletionRequests: 'Deletion Requests',
  requestedBy: 'Asked by {user}',
  seasons: '{count, plural, one {Season {list}} other {Seasons {list}}}',
  wholeMovie: 'The movie',
  approve: 'Approve & Delete',
  decline: 'Decline',
  approved: '{title} was deleted.',
  declined: 'Deletion request declined.',
  failed: 'Something went wrong. Please try again.',
});

/** Pending deletion requests, for the sidebar badge and the list below. */
export const useDeletionRequests = (enabled: boolean) =>
  useSWR<{ results: SerializedDeletionRequest[]; pending: number }>(
    enabled ? '/api/v1/deletion/requests' : null,
    { refreshInterval: 60 * 1000 }
  );

const DeletionRequestRow = ({
  request,
  onDone,
}: {
  request: SerializedDeletionRequest;
  onDone: () => void;
}) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [working, setWorking] = useState(false);
  const type = request.media.mediaType === 'tv' ? 'tv' : 'movie';
  const { data } = useSWR<MovieDetails | TvDetails>(
    `/api/v1/${type}/${request.media.tmdbId}`
  );
  const title = data ? ('title' in data ? data.title : data.name) : '';

  const act = async (action: 'approve' | 'decline') => {
    setWorking(true);

    try {
      await axios.post(`/api/v1/deletion/requests/${request.id}/${action}`);
      addToast(
        action === 'approve'
          ? intl.formatMessage(messages.approved, { title })
          : intl.formatMessage(messages.declined),
        { autoDismiss: true, appearance: 'success' }
      );
      onDone();
    } catch {
      addToast(intl.formatMessage(messages.failed), {
        autoDismiss: true,
        appearance: 'error',
      });
    } finally {
      setWorking(false);
    }
  };

  return (
    <li className="flex flex-col gap-3 rounded-xl bg-gray-800 p-4 ring-1 ring-red-800 sm:flex-row sm:items-center">
      <Link
        href={`/${type}/${request.media.tmdbId}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <div className="relative h-16 w-11 flex-shrink-0 overflow-hidden rounded bg-gray-700">
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
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold text-white">
            {title}
          </div>
          <div className="text-sm text-gray-300">
            {request.seasons?.length
              ? intl.formatMessage(messages.seasons, {
                  count: request.seasons.length,
                  list: request.seasons.join(', '),
                })
              : intl.formatMessage(messages.wholeMovie)}
            {' · '}
            {intl.formatMessage(messages.requestedBy, {
              user: request.requestedBy.displayName,
            })}
          </div>
          {request.reason && (
            <div className="mt-1 text-sm italic text-gray-400">
              “{request.reason}”
            </div>
          )}
        </div>
      </Link>
      <div className="flex flex-shrink-0 gap-2">
        <Button
          buttonType="danger"
          buttonSize="sm"
          disabled={working}
          onClick={() => act('approve')}
        >
          <CheckIcon />
          <span>{intl.formatMessage(messages.approve)}</span>
        </Button>
        <Button
          buttonType="default"
          buttonSize="sm"
          disabled={working}
          onClick={() => act('decline')}
        >
          <XMarkIcon />
          <span>{intl.formatMessage(messages.decline)}</span>
        </Button>
      </div>
    </li>
  );
};

/** Pending deletion requests at the top of the Requests page, for admins. */
const DeletionRequests = () => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const { data, mutate } = useDeletionRequests(
    hasPermission(Permission.MANAGE_REQUESTS)
  );

  if (!data || data.results.length === 0) {
    return null;
  }

  return (
    <section className="mb-6">
      <h3 className="mb-3 text-xl font-bold text-red-400">
        {intl.formatMessage(messages.deletionRequests)}
        <span className="ml-2 text-base font-medium text-gray-400">
          {data.pending}
        </span>
      </h3>
      <ul className="space-y-2">
        {data.results.map((request) => (
          <DeletionRequestRow
            key={request.id}
            request={request}
            onDone={() => mutate()}
          />
        ))}
      </ul>
    </section>
  );
};

export default DeletionRequests;
