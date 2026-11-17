import { meterColor } from '@app/components/Common/StorageMeter';
import useMyStorage from '@app/hooks/useMyStorage';
import defineMessages from '@app/utils/defineMessages';
import { formatSize } from '@app/utils/formatSize';
import Link from 'next/link';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.RequestModal.StorageNotice', {
  left: 'You have {left} of storage left ({used} of {limit} used).',
  full: 'Your storage is full, so you can\u2019t request anything new right now.',
  freeUp: 'Free up space in My Media',
});

/**
 * The requester's storage, right where they request: how much room is left,
 * or that they're full and where to make room. Hidden without a limit, and
 * when requesting for someone else.
 */
const StorageNotice = ({
  forSomeoneElse = false,
}: {
  forSomeoneElse?: boolean;
}) => {
  const intl = useIntl();
  const { data } = useMyStorage();

  if (forSomeoneElse || !data?.limitBytes) {
    return null;
  }

  const fraction = Math.min(1, data.usedBytes / data.limitBytes);

  return (
    <div
      className={`mb-6 rounded-md p-4 ring-1 ${
        data.restricted
          ? 'bg-red-900/40 ring-red-500'
          : 'bg-gray-800 ring-gray-700'
      }`}
    >
      <p
        className={
          data.restricted ? 'font-medium text-red-200' : 'text-gray-200'
        }
      >
        {data.restricted
          ? intl.formatMessage(messages.full)
          : intl.formatMessage(messages.left, {
              left: formatSize(data.limitBytes - data.usedBytes),
              used: formatSize(data.usedBytes),
              limit: formatSize(data.limitBytes),
            })}
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-700">
        <div
          className={`h-full rounded-full ${meterColor(fraction, data.restricted)}`}
          style={{ width: `${Math.max(2, Math.round(fraction * 100))}%` }}
        />
      </div>
      {data.restricted && (
        <Link
          href="/my-media"
          className="mt-3 inline-block font-semibold text-white underline"
        >
          {intl.formatMessage(messages.freeUp)}
        </Link>
      )}
    </div>
  );
};

export default StorageNotice;
