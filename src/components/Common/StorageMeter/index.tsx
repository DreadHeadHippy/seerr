import useMyStorage from '@app/hooks/useMyStorage';
import defineMessages from '@app/utils/defineMessages';
import { formatSize } from '@app/utils/formatSize';
import { CircleStackIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Common.StorageMeter', {
  yourStorage: 'Your Storage',
  usedOf: '{used} of {limit}',
  left: '{left} left',
  full: 'Full: delete something to request more',
  fullShort: 'Storage full',
});

/** How full a storage limit is: colour for the bar and text. */
export const meterColor = (fraction: number, full: boolean) =>
  full ? 'bg-red-500' : fraction > 0.8 ? 'bg-amber-500' : 'bg-indigo-500';

/**
 * The signed-in user's storage against their limit, always on screen (in
 * the sidebar and menus) when they have one. Opens My Media.
 */
const StorageMeter = ({
  onClick,
  variant = 'card',
}: {
  onClick?: () => void;
  /** card: sidebar and menus. strip: one thin line above the phone menu. */
  variant?: 'card' | 'strip';
}) => {
  const intl = useIntl();
  const { data } = useMyStorage();

  if (!data?.limitBytes) {
    return null;
  }

  const fraction = Math.min(1, data.usedBytes / data.limitBytes);
  const bar = (
    <div
      className={`h-full rounded-full ${meterColor(fraction, data.restricted)}`}
      style={{ width: `${Math.max(2, Math.round(fraction * 100))}%` }}
    />
  );

  if (variant === 'strip') {
    return (
      <Link
        href="/my-media"
        onClick={onClick}
        className={`flex items-center gap-3 border-t px-6 py-1.5 text-xs ${
          data.restricted
            ? 'border-red-500 bg-red-900/80 text-red-100'
            : 'border-gray-600 bg-gray-800/90 text-gray-200'
        } backdrop-blur`}
      >
        <CircleStackIcon className="h-4 w-4 flex-shrink-0" />
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-700">
          {bar}
        </div>
        <span className="whitespace-nowrap">
          {data.restricted
            ? intl.formatMessage(messages.fullShort)
            : intl.formatMessage(messages.usedOf, {
                used: formatSize(data.usedBytes),
                limit: formatSize(data.limitBytes),
              })}
        </span>
      </Link>
    );
  }

  return (
    <Link
      href="/my-media"
      onClick={onClick}
      className={`block rounded-md px-3 py-3 ring-1 transition hover:bg-gray-700/60 ${
        data.restricted ? 'bg-red-900/40 ring-red-500' : 'ring-gray-700'
      }`}
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-white">
        <CircleStackIcon className="h-5 w-5 flex-shrink-0" />
        <span>{intl.formatMessage(messages.yourStorage)}</span>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-gray-700">
        {bar}
      </div>
      <div className="mt-1.5 flex justify-between gap-2 text-xs text-gray-300">
        <span>
          {intl.formatMessage(messages.usedOf, {
            used: formatSize(data.usedBytes),
            limit: formatSize(data.limitBytes),
          })}
        </span>
        {!data.restricted && (
          <span>
            {intl.formatMessage(messages.left, {
              left: formatSize(data.limitBytes - data.usedBytes),
            })}
          </span>
        )}
      </div>
      {data.restricted && (
        <div className="mt-1 text-xs font-medium text-red-300">
          {intl.formatMessage(messages.full)}
        </div>
      )}
    </Link>
  );
};

export default StorageMeter;
