interface DownloadRingProps {
  /** 0 to 1. */
  progress: number;
  /** Downloaded; being imported. */
  importing?: boolean;
}

const RADIUS = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * A ring in the middle of a poster that fills as the download progresses,
 * with the percentage inside. Full and pulsing while it's being imported.
 */
const DownloadRing = ({ progress, importing = false }: DownloadRingProps) => {
  const shown = importing ? 1 : Math.min(1, Math.max(0, progress));
  const percent = Math.floor(shown * 100);

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
          strokeDashoffset={CIRCUMFERENCE * (1 - shown)}
          // Readings arrive about every 1.5s; gliding between them keeps it
          // smooth without running ahead of qBittorrent.
          className="stroke-indigo-400 transition-[stroke-dashoffset] duration-[1500ms] ease-linear"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-white sm:text-base">
        {percent}%
      </span>
    </div>
  );
};

export default DownloadRing;
