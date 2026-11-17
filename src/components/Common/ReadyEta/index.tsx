import useReadyEta, { readyAtFromDownloads } from '@app/hooks/useReadyEta';
import type { DownloadingItem } from '@server/lib/downloadtracker';

interface ReadyEtaProps {
  downloads?: DownloadingItem[];
  className?: string;
}

/**
 * "Ready in about 25 minutes" next to a movie or series status badge, so
 * requesters can see when it will be watchable. Always visible, unlike the
 * download tooltip (hover only, hidden on phones).
 */
const ReadyEta = ({ downloads = [], className = '' }: ReadyEtaProps) => {
  const eta = useReadyEta(
    downloads.length > 0,
    readyAtFromDownloads(downloads)
  );

  if (!eta) {
    return null;
  }

  return (
    <span
      className={`whitespace-nowrap text-xs font-medium text-indigo-300 ${className}`}
    >
      {eta.full}
    </span>
  );
};

export default ReadyEta;
