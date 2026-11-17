import type { DownloadingItem } from '@server/lib/downloadtracker';

interface DownloadRingProps {
  downloads: DownloadingItem[];
  /** Downloaded and left the queue; being imported. */
  complete?: boolean;
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

const RADIUS = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * A ring in the middle of a poster that fills as the download progresses,
 * with the percentage inside. Full and pulsing once downloaded, while it's
 * being imported.
 */
const DownloadRing = ({ downloads, complete = false }: DownloadRingProps) => {
  const progress = complete ? 1 : downloadProgress(downloads);
  const importing = progress >= 1;
  const percent = Math.floor(progress * 100);

  return (
    <div
      className={`relative h-16 w-16 rounded-full bg-gray-900/70 shadow-lg backdrop-blur-sm sm:h-20 sm:w-20 ${
        importing ? 'animate-pulse' : ''
      }`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
        <circle
          cx="32"
          cy="32"
          r={RADIUS}
          fill="none"
          strokeWidth="5"
          className="stroke-white/20"
        />
        <circle
          cx="32"
          cy="32"
          r={RADIUS}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
          className="stroke-indigo-400 transition-[stroke-dashoffset] duration-1000 ease-out"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-white sm:text-base">
        {percent}%
      </span>
    </div>
  );
};

export default DownloadRing;
