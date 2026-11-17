import type { DownloadingItem } from '@server/lib/downloadtracker';

interface DownloadRingProps {
  downloads: DownloadingItem[];
  /** Downloaded and left the queue; being imported. */
  complete?: boolean;
  // Smaller on mobile, like StatusBadgeMini's shrink (TitleCard)
  shrink?: boolean;
}

/** How far along these downloads are together, 0 to 1. */
export const downloadProgress = (downloads: DownloadingItem[]): number => {
  const size = downloads.reduce((sum, item) => sum + (item.size || 0), 0);
  const left = downloads.reduce((sum, item) => sum + (item.sizeLeft || 0), 0);

  if (
    downloads.length > 0 &&
    downloads.every((item) => item.status === 'completed')
  ) {
    return 1;
  }

  return size > 0 ? Math.min(1, Math.max(0, 1 - left / size)) : 0;
};

const RADIUS = 8;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * A ring that fills as the download progresses, in the Processing badge's
 * colours. Full and pulsing once downloaded, while it's being imported.
 */
const DownloadRing = ({
  downloads,
  complete = false,
  shrink = false,
}: DownloadRingProps) => {
  const progress = complete ? 1 : downloadProgress(downloads);
  const importing = progress >= 1;

  return (
    <div
      className={`relative inline-flex rounded-full bg-indigo-500/80 shadow-md ${
        shrink ? 'h-4 w-4 sm:h-5 sm:w-5' : 'h-5 w-5'
      } ${importing ? 'animate-pulse' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
    >
      <svg viewBox="0 0 20 20" className="h-full w-full -rotate-90">
        <circle
          cx="10"
          cy="10"
          r={RADIUS}
          fill="none"
          strokeWidth="3"
          className="stroke-indigo-300/30"
        />
        <circle
          cx="10"
          cy="10"
          r={RADIUS}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
          className="stroke-indigo-100 transition-[stroke-dashoffset] duration-1000 ease-out"
        />
      </svg>
    </div>
  );
};

export default DownloadRing;
