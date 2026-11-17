import Button from '@app/components/Common/Button';
import Modal from '@app/components/Common/Modal';
import useToasts from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import { TrashIcon } from '@heroicons/react/24/outline';
import { MediaStatus } from '@server/constants/media';
import type { DeletionOptions } from '@server/interfaces/api/deletionInterfaces';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.DeleteOwnMedia', {
  delete: 'Delete',
  requestDeletion: 'Ask to Delete',
  deletionRequested: 'Deletion Requested',
  deleteTitle: 'Delete {title}',
  requestTitle: 'Ask to Delete {title}',
  pendingTitle: 'Deletion Requested',
  movieDelete:
    'This removes the movie and its files from the server for everyone. It frees up your storage.',
  movieRequest: 'An admin will review this. Deleting it frees up your storage.',
  movieShared: 'Someone else requested this too, so an admin will review it.',
  chooseSeasons: 'Choose the seasons you requested to delete:',
  seasonLabel: 'Season {seasonNumber}',
  sharedSeason: 'also requested by someone else; needs approval',
  seriesRequestNote: 'An admin will review this before anything is deleted.',
  reason: 'Reason (optional)',
  withdraw: 'Withdraw Request',
  pendingNote: 'You asked for this to be deleted. An admin will review it.',
  deleted: '{title} was deleted.',
  requested: 'Deletion of {title} requested.',
  withdrawn: 'Deletion request withdrawn.',
  failed: 'Something went wrong. Please try again.',
  working: 'Working…',
});

interface DeleteOwnMediaProps {
  /** Seerr's media id (mediaInfo.id). */
  mediaId?: number;
  status?: MediaStatus;
  title: string;
  backdropPath?: string;
  /** Called after a deletion, to refresh the page. */
  onDeleted?: () => void;
  /** Fill the width, e.g. under a poster. */
  block?: boolean;
}

/**
 * Lets a user delete media they requested, or ask an admin to, depending
 * on their deletion mode. Shown only to someone who requested it.
 */
const DeleteOwnMedia = ({
  mediaId,
  status,
  title,
  backdropPath,
  onDeleted,
  block = false,
}: DeleteOwnMediaProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [show, setShow] = useState(false);
  const [working, setWorking] = useState(false);
  const [seasons, setSeasons] = useState<number[]>([]);
  const [reason, setReason] = useState('');
  const relevant =
    status === MediaStatus.AVAILABLE ||
    status === MediaStatus.PARTIALLY_AVAILABLE ||
    status === MediaStatus.PROCESSING;
  const { data, mutate } = useSWR<DeletionOptions>(
    mediaId && relevant ? `/api/v1/deletion/media/${mediaId}` : null
  );

  // Every season they requested, ticked by default.
  const ownedSeasons = data?.seasons.map((s) => s.seasonNumber).join(',');
  useEffect(() => {
    setSeasons(ownedSeasons ? ownedSeasons.split(',').map(Number) : []);
  }, [ownedSeasons]);

  if (!data || !data.owns || data.mode === 'none') {
    return null;
  }

  const isSeries = data.seasons.length > 0;
  const sharedChosen = isSeries
    ? data.seasons.some((s) => s.shared && seasons.includes(s.seasonNumber))
    : data.shared;
  const asRequest = data.mode === 'request' || sharedChosen;
  const pending = data.pending;

  const submit = async () => {
    setWorking(true);

    try {
      const response = await axios.post<{ result: 'deleted' | 'requested' }>(
        `/api/v1/deletion/media/${mediaId}`,
        { seasons: isSeries ? seasons : undefined, reason: reason || undefined }
      );

      addToast(
        intl.formatMessage(
          response.data.result === 'deleted'
            ? messages.deleted
            : messages.requested,
          { title }
        ),
        { autoDismiss: true, appearance: 'success' }
      );
      setShow(false);
      mutate();

      if (response.data.result === 'deleted') {
        onDeleted?.();
      }
    } catch {
      addToast(intl.formatMessage(messages.failed), {
        autoDismiss: true,
        appearance: 'error',
      });
    } finally {
      setWorking(false);
    }
  };

  const withdraw = async () => {
    if (!pending) {
      return;
    }

    setWorking(true);

    try {
      await axios.delete(`/api/v1/deletion/requests/${pending.id}`);
      addToast(intl.formatMessage(messages.withdrawn), {
        autoDismiss: true,
        appearance: 'info',
      });
      setShow(false);
      mutate();
    } catch {
      addToast(intl.formatMessage(messages.failed), {
        autoDismiss: true,
        appearance: 'error',
      });
    } finally {
      setWorking(false);
    }
  };

  const label = intl.formatMessage(
    pending
      ? messages.deletionRequested
      : data.mode === 'direct'
        ? messages.delete
        : messages.requestDeletion
  );

  return (
    <>
      <Button
        buttonType={pending ? 'default' : 'danger'}
        className={block ? 'w-full justify-center' : 'ml-2 first:ml-0'}
        onClick={() => setShow(true)}
      >
        <TrashIcon />
        <span>{label}</span>
      </Button>
      <Transition
        as="div"
        enter="transition-opacity duration-300"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition-opacity duration-300"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
        show={show}
      >
        <Modal
          backgroundClickable
          title={
            pending
              ? intl.formatMessage(messages.pendingTitle)
              : intl.formatMessage(
                  asRequest ? messages.requestTitle : messages.deleteTitle,
                  { title }
                )
          }
          onCancel={() => setShow(false)}
          onOk={pending ? withdraw : submit}
          okText={
            working
              ? intl.formatMessage(messages.working)
              : pending
                ? intl.formatMessage(messages.withdraw)
                : intl.formatMessage(
                    asRequest ? messages.requestDeletion : messages.delete
                  )
          }
          okButtonType={pending ? 'default' : 'danger'}
          okDisabled={working || (!pending && isSeries && seasons.length === 0)}
          backdrop={
            backdropPath
              ? `https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${backdropPath}`
              : undefined
          }
        >
          {pending ? (
            <p>{intl.formatMessage(messages.pendingNote)}</p>
          ) : (
            <div className="space-y-4">
              {isSeries ? (
                <>
                  <p>{intl.formatMessage(messages.chooseSeasons)}</p>
                  <ul className="space-y-2">
                    {data.seasons.map((season) => (
                      <li key={season.seasonNumber}>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={seasons.includes(season.seasonNumber)}
                            onChange={() =>
                              setSeasons((chosen) =>
                                chosen.includes(season.seasonNumber)
                                  ? chosen.filter(
                                      (n) => n !== season.seasonNumber
                                    )
                                  : [...chosen, season.seasonNumber]
                              )
                            }
                          />
                          <span>
                            {intl.formatMessage(messages.seasonLabel, {
                              seasonNumber: season.seasonNumber,
                            })}
                          </span>
                          {season.shared && (
                            <span className="text-sm text-gray-400">
                              ({intl.formatMessage(messages.sharedSeason)})
                            </span>
                          )}
                        </label>
                      </li>
                    ))}
                  </ul>
                  {asRequest && (
                    <p className="text-sm text-gray-400">
                      {intl.formatMessage(messages.seriesRequestNote)}
                    </p>
                  )}
                </>
              ) : (
                <p>
                  {intl.formatMessage(
                    data.shared
                      ? messages.movieShared
                      : asRequest
                        ? messages.movieRequest
                        : messages.movieDelete
                  )}
                </p>
              )}
              {asRequest && (
                <label className="block">
                  <span className="text-sm text-gray-300">
                    {intl.formatMessage(messages.reason)}
                  </span>
                  <textarea
                    className="mt-1 w-full"
                    rows={2}
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              )}
            </div>
          )}
        </Modal>
      </Transition>
    </>
  );
};

export default DeleteOwnMedia;
